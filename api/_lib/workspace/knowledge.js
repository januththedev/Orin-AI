import { randomUUID, createHash } from "node:crypto";
import { fail } from "./repository.js";
import { ProviderRouter, eligible, modelScore } from "./providers.js";

export function chunkMarkdown(markdown, title = "Untitled") {
  const text = String(markdown).replace(/\r\n/g, "\n").trim();
  if (!text) throw fail(400, "The Markdown file is empty.");
  if (Buffer.byteLength(text, "utf8") > 512000)
    throw fail(400, "Markdown files must be smaller than 500 KB.");
  const blocks = [];
  let paragraph = "",
    fence = null;
  const add = () => {
    if (paragraph.trim()) blocks.push(paragraph.trim());
    paragraph = "";
  };
  for (const line of text.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) {
        add();
        fence = marker[0];
      } else if (marker[0] === fence) {
        paragraph += line + "\n";
        add();
        fence = null;
        continue;
      }
    }
    if (!fence && !line.trim()) {
      add();
      continue;
    }
    if (!fence && /^#{1,6}\s/.test(line)) add();
    paragraph += line + "\n";
  }
  add();
  const chunks = [];
  let section = title,
    buffer = "";
  const flush = () => {
    if (buffer.trim()) {
      chunks.push({ section, content: buffer.trim() });
      buffer = "";
    }
  };
  for (const block of blocks) {
    const heading = /^#{1,6}\s+(.+)$/m.exec(block);
    if (/^#{1,6}\s/.test(block)) {
      flush();
      section = heading?.[1] || section;
    }
    // Preserve fenced code and tables. Oversized blocks are rejected rather than silently truncated.
    if (block.length > 24000)
      throw fail(
        400,
        "A section exceeds 24,000 characters. Split it into smaller Markdown sections.",
      );
    if (buffer.length + block.length > 2400) flush();
    buffer += (buffer ? "\n\n" : "") + block;
  }
  flush();
  return chunks.map((c, ordinal) => ({ ...c, ordinal }));
}
export async function uploadDocument(repo, input, actor) {
  const markdown = String(input.markdown || "");
  const title = String(
    input.title || /^#\s+(.+)$/m.exec(markdown)?.[1] || "Untitled document",
  ).slice(0, 140);
  const chunks = chunkMarkdown(markdown, title);
  const hash = createHash("sha256").update(markdown).digest("hex");
  const duplicate = (await repo.list("documents")).find(
    (d) => d.hash === hash && d.status !== "archived" && d.id !== input.id,
  );
  if (duplicate) throw fail(409, "This document has already been uploaded.");
  const previous = input.id ? await repo.get("documents", input.id) : null;
  if (input.id && !previous) throw fail(404, "Document not found.");
  const id = previous?.id || randomUUID(),
    version = randomUUID();
  const doc = {
    id,
    title,
    markdown,
    hash,
    version,
    publishedVersion: previous?.publishedVersion || null,
    publishedEmbeddingSpace: previous?.publishedEmbeddingSpace || null,
    status: previous?.status === "published" ? "published" : "draft",
    indexStatus: "queued",
    chunkCount: chunks.length,
    language: ["en", "si", "ta", "mixed"].includes(input.language)
      ? input.language
      : "en",
    source: String(input.source || "").slice(0, 500),
    allowPublicProcessing: input.allowPublicProcessing === true,
    createdBy: actor,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await repo.put("documents", id, doc);
  await repo.put("document_versions", `${id}:${version}`, {
    ...doc,
    documentId: id,
  });
  const job = {
    id: randomUUID(),
    documentId: id,
    version,
    status: "queued",
    offset: 0,
    total: chunks.length,
    leaseUntil: 0,
    attempts: 0,
  };
  await repo.put("jobs", job.id, job);
  return doc;
}
export async function processJob(
  repo,
  jobId,
  {
    routerFactory = () =>
      new ProviderRouter(repo, { deadlineMs: 24000, maxAttempts: 2 }),
  } = {},
) {
  const lease = await repo.leaseJob(jobId, randomUUID());
  if (!lease) return { busy: true };
  try {
    const doc = await repo.get("documents", lease.documentId);
    if (!doc || doc.version !== lease.version) {
      await repo.patch("jobs", jobId, { status: "cancelled", leaseUntil: 0 });
      return { cancelled: true };
    }
    const all = chunkMarkdown(doc.markdown, doc.title);
    const batch = all.slice(lease.offset, lease.offset + 8);
    const config = await repo.get("settings", "retrieval");
    let space = lease.embeddingSpace || config?.embeddingSpace;
    const models = await repo.list("models");
    if (!space)
      space = models
        .filter((m) => eligible(m, "embedding"))
        .sort((a, b) => modelScore(b) - modelScore(a))[0]?.embeddingSpace;
    let vectors = null,
      warning = null;
    if (space) {
      try {
        const result = await routerFactory().run(
          "embedding",
          {
            input: batch.map((c) => `${doc.title}\n${c.section}\n${c.content}`),
            inputType: "document",
            allowPublicProcessing: doc.allowPublicProcessing === true,
          },
          { space, validate: (d) => validEmbeddings(d, batch.length) },
        );
        vectors = result.data.data
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
        if (vectors.some((v) => v.length !== result.model.dimensions))
          throw new Error("Embedding dimensions do not match configuration");
      } catch {
        vectors = null;
        warning =
          "Embedding unavailable. Indexed for keyword search; retry embedding before publishing if semantic retrieval is needed.";
      }
    } else
      warning =
        "No compatible embedding model configured. Keyword indexing is available.";
    await repo.addChunks(
      batch.map((c, i) => ({
        ...c,
        id: randomUUID(),
        document_id: doc.id,
        version: doc.version,
        title: doc.title,
        embedding_space: vectors ? space : null,
        embedding: vectors?.[i] || null,
      })),
    );
    const offset = lease.offset + batch.length;
    const complete = offset >= all.length;
    const degraded = !!(warning || lease.warning);
    await repo.patch("jobs", jobId, {
      status: complete ? "complete" : "queued",
      offset,
      leaseUntil: 0,
      warning: warning || lease.warning || null,
      embeddingSpace: space || null,
    });
    const current = await repo.get("documents", doc.id);
    if (current?.version !== doc.version) {
      await repo.patch("jobs", jobId, { status: "cancelled", leaseUntil: 0 });
      return { cancelled: true };
    }
    await repo.patch("document_versions", `${doc.id}:${doc.version}`, {
      indexStatus: complete
        ? degraded
          ? "keyword_ready"
          : "ready"
        : "indexing",
      embeddingSpace: space || null,
    });
    await repo.patch("documents", doc.id, {
      indexStatus: complete
        ? degraded
          ? "keyword_ready"
          : "ready"
        : "indexing",
      embeddingSpace: space || null,
      indexWarning: warning || lease.warning || null,
      updatedAt: new Date().toISOString(),
    });
    return { complete, offset, total: all.length, warning };
  } catch (error) {
    await repo.patch("jobs", jobId, {
      status: "failed",
      leaseUntil: 0,
      attempts: (lease.attempts || 0) + 1,
      error: "Indexing failed. Check model configuration and retry.",
    });
    if (
      (await repo.get("documents", lease.documentId))?.version === lease.version
    )
      await repo.patch("documents", lease.documentId, {
        indexStatus: "failed",
      });
    throw error;
  }
}
export function validEmbeddings(data, count) {
  return (
    Array.isArray(data?.data) &&
    data.data.length === count &&
    new Set(data.data.map((d) => d.index)).size === count &&
    data.data.every(
      (d) =>
        Number.isInteger(d.index) &&
        d.index >= 0 &&
        d.index < count &&
        Array.isArray(d.embedding) &&
        d.embedding.length &&
        d.embedding.every(Number.isFinite),
    )
  );
}
export function fuseResults(keyword, vector) {
  const map = new Map();
  for (const list of [keyword, vector])
    list.forEach((item, i) => {
      const prior = map.get(item.id) || { ...item, score: 0 };
      prior.score += 1 / (60 + i + 1);
      map.set(item.id, prior);
    });
  return [...map.values()].sort((a, b) => b.score - a.score);
}
export async function retrieve(
  repo,
  query,
  {
    routerFactory = () =>
      new ProviderRouter(repo, { deadlineMs: 12000, maxAttempts: 2 }),
    rerank = true,
    allowPublicProcessing = false,
  } = {},
) {
  const settings = await repo.get("settings", "retrieval");
  const documents = (await repo.list("documents")).filter(
    (d) => d.status === "published",
  );
  const spaces = [
    ...new Set(
      documents
        .map((d) => d.publishedEmbeddingSpace || d.embeddingSpace)
        .filter(Boolean),
    ),
  ];
  const requested = settings?.embeddingSpace;
  const space = requested || spaces[0];
  let embedding = null;
  const degraded = [];
  if (space) {
    try {
      const result = await routerFactory().run(
        "embedding",
        { input: [query], inputType: "query", allowPublicProcessing },
        { space, validate: (d) => validEmbeddings(d, 1) },
      );
      embedding = result.data.data[0].embedding;
      if (embedding.length !== result.model.dimensions)
        throw new Error("Dimension mismatch");
    } catch {
      embedding = null;
      degraded.push("semantic_search_unavailable");
    }
  }
  const candidates = await repo.retrieve(query, embedding, space);
  let fused = fuseResults(candidates.keyword, candidates.vector).slice(0, 20);
  if (rerank && fused.length > 1) {
    try {
      const result = await routerFactory().run(
        "rerank",
        {
          query,
          allowPublicProcessing,
          documents: fused.map((d) => `${d.title}\n${d.section}\n${d.content}`),
        },
        { validate: (d) => validRerank(d, fused.length) },
      );
      const ranked = result.data.results || result.data.rankings;
      fused = ranked.map((r) => ({
        ...fused[r.index],
        rerankScore: r.relevance_score ?? r.logit,
      }));
    } catch {
      degraded.push("reranker_unavailable");
    }
  }
  const selected = [];
  let size = 0;
  for (const c of fused) {
    if (selected.length >= 6 || size + c.content.length > 14000) break;
    size += c.content.length;
    selected.push({ ...c, index: selected.length + 1 });
  }
  return {
    sources: selected.map(({ embedding, ...c }) => c),
    degraded,
    embeddingSpace: space || null,
  };
}
export function validRerank(data, count) {
  const r = data?.results || data?.rankings;
  return (
    Array.isArray(r) &&
    r.length > 0 &&
    r.length <= count &&
    new Set(r.map((i) => i.index)).size === r.length &&
    r.every(
      (i) =>
        Number.isInteger(i.index) &&
        i.index >= 0 &&
        i.index < count &&
        Number.isFinite(i.relevance_score ?? i.logit),
    )
  );
}
