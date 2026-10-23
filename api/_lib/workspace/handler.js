import { adminAuth } from "./admin-auth.js";
import { tick } from "./jobs.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Repository, fail } from "./repository.js";
import { authenticate, requireAdmin } from "./auth.js";
import {
  PROVIDERS,
  publicCredential,
  saveCredential,
  validateModel,
  refreshCatalog,
  modelScore,
  ProviderRouter,
} from "./providers.js";
import { uploadDocument, processJob, retrieve } from "./knowledge.js";
import { answer } from "./chat.js";
import { refreshBenchmarks, screenModel } from "./intelligence.js";
import { encryptToken } from "../crypto.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value) {
  if (!UUID.test(String(value || ""))) throw fail(400, "Invalid identifier.");
  return value;
}
function cursor(value) {
  if (!value) return null;
  try {
    const d = typeof value === "string" ? JSON.parse(value) : value;
    if (!Number.isFinite(Date.parse(d.at))) throw Error();
    uuid(d.id);
    return d;
  } catch {
    throw fail(400, "Invalid pagination cursor.");
  }
}
function safeDoc({ markdown, ...doc }) {
  return doc;
}
export function createWorkspaceHandler({
  repository = new Repository(),
  identify = authenticate,
  demo = false,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      throw fail(405, "GET or POST required.");
    }
    const body = req.body || {};
    const url = new URL(req.url, "https://workspace.invalid");
    const action =
      req.method === "GET"
        ? url.searchParams.get("action") || "bootstrap"
        : body.action;
    // A separate server-to-server secret drives bounded background batches; no public demo bypass.
    if (action === "tick") {
      const expected = process.env.ORIN_WORKER_SECRET || "";
      const supplied = String(req.headers.authorization || "").replace(
        /^Bearer /,
        "",
      );
      if (
        expected.length < 32 ||
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
      )
        throw fail(401, "Unauthorized worker.");
      return res.status(200).json(await tick(repository));
    }
    if (await adminAuth.handle(action, req, res, repository)) return;
    const administration = !["bootstrap", "conversations", "messages", "conversation.update", "chat", "source"].includes(action);
    const account = administration && !demo
      ? await adminAuth.require(req)
      : await identify(req, repository);
    const uid = account.id;
    if (!(await repository.rate(`api:${uid}`, 120, 60000)))
      throw fail(429, "Too many requests. Please wait a moment.");
    if (action === "bootstrap")
      return res.status(200).json({
        account,
        demo,
        providers: Object.entries(PROVIDERS).map(([id, p]) => ({
          id,
          label: p.label,
          services: p.services,
        })),
      });
    if (action === "conversations")
      return res.status(200).json(
        await repository.conversations(uid, {
          cursor: cursor(body.cursor || url.searchParams.get("cursor")),
          search: body.search || url.searchParams.get("search") || "",
        }),
      );
    if (action === "messages")
      return res
        .status(200)
        .json(
          await repository.messages(
            uid,
            uuid(body.id || url.searchParams.get("id")),
            cursor(body.before || url.searchParams.get("before")),
          ),
        );
    if (action === "conversation.update") {
      if (typeof body.title === "string" && !body.title.trim())
        throw fail(400, "Title cannot be empty.");
      return res.status(200).json(
        await repository.updateConversation(uid, uuid(body.id), {
          ...(typeof body.title === "string"
            ? { title: body.title.trim().slice(0, 120) }
            : {}),
          ...(typeof body.thinking === "boolean"
            ? { thinking: body.thinking }
            : {}),
          deleted: body.deleted === true,
        }),
      );
    }
    if (action === "chat") {
      if (req.method !== "POST") throw fail(405, "POST required");
      uuid(body.conversationId);
      uuid(body.requestId);
      if (!(await repository.rate(`chat:${uid}`, 20, 60000)))
        throw fail(429, "Message limit reached. Try again in a minute.");
      if (body.stream === true) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        const emit = (event, data) => {
          if (!res.destroyed && !res.writableEnded)
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        try {
          const result = await answer(repository, account, body, {
            demo,
            onDelta: (text) => emit("delta", { text }),
            onStatus: (status) => emit("status", { status }),
          });
          emit("done", result);
        } catch (error) {
          emit("error", {
            error: error.code
              ? error.message
              : "This answer could not be completed.",
            code: error.code || 500,
          });
        } finally {
          res.end();
        }
        return;
      }
      return res
        .status(200)
        .json(await answer(repository, account, body, { demo }));
    }
    if (action === "source") {
      const doc = await repository.get(
        "documents",
        String(body.id || url.searchParams.get("id")),
      );
      if (!doc || doc.status !== "published")
        throw fail(404, "Published source not found.");
      return res.status(200).json({
        document: safeDoc(doc),
        chunks: await repository.chunks(doc.id, doc.publishedVersion),
      });
    }
    requireAdmin(account);
    if (
      demo &&
      [
        "provider.test",
        "catalog.refresh",
        "benchmark.refresh",
        "model.screen",
      ].includes(action)
    )
      throw fail(409, "Live provider calls are disabled in the local demo.");
    const audit = async (detail) =>
      repository.put("audit", randomUUID(), {
        action,
        actor: uid,
        detail,
        at: new Date().toISOString(),
      });
    if (action === "admin.snapshot") {
      const [
        keys,
        models,
        documents,
        jobs,
        catalog,
        benchmarks,
        retrieval,
        events,
      ] = await Promise.all([
        repository.list("credentials"),
        repository.list("models"),
        repository.list("documents"),
        repository.list("jobs"),
        repository.get("settings", "catalog"),
        repository.get("settings", "benchmarks"),
        repository.get("settings", "retrieval"),
        repository.list("audit"),
      ]);
      return res.status(200).json({
        credentials: keys.map(publicCredential),
        models: models.map((m) => ({
          ...m,
          balancedScore: modelScore(m),
          bestScore: modelScore(m, true),
        })),
        documents: documents.map(safeDoc),
        jobs,
        catalog,
        benchmarks: benchmarks
          ? {
              configured: !!benchmarks.ciphertext,
              refreshedAt: benchmarks.refreshedAt,
              matched: benchmarks.matched,
            }
          : null,
        retrieval,
        audit: events.slice(0, 30),
      });
    }
    if (req.method !== "POST") throw fail(405, "POST required");
    if (action === "provider.add") {
      const c = await saveCredential(repository, body);
      await audit({ provider: c.provider, credentialId: c.id });
      return res.status(200).json(c);
    }
    if (action === "provider.toggle") {
      const c = await repository.get("credentials", body.id);
      if (!c) throw fail(404, "Credential not found");
      await repository.patch("credentials", body.id, {
        enabled: body.enabled === true,
        cooldownUntil: 0,
        health: "untested",
      });
      await audit({ credentialId: body.id });
      return res.status(200).json({ ok: true });
    }
    if (action === "provider.delete") {
      await repository.delete("credentials", String(body.id));
      await audit({ credentialId: body.id });
      return res.status(200).json({ ok: true });
    }
    if (action === "provider.test") {
      const c = await repository.get("credentials", String(body.id));
      if (!c) throw fail(404, "Credential not found");
      const { decryptToken } = await import("../crypto.js");
      const response = await fetch(`${PROVIDERS[c.provider].base}/models`, {
        headers: { authorization: `Bearer ${decryptToken(c.ciphertext)}` },
        signal: AbortSignal.timeout(8000),
      });
      await repository.patch("credentials", c.id, {
        health: response.ok ? "healthy" : "failed",
      });
      return res.status(200).json({ ok: response.ok, status: response.status });
    }
    if (action === "model.save") {
      const model = validateModel(body);
      const prior = await repository.get("models", model.id);
      await repository.put("models", model.id, {
        ...prior,
        ...model,
        evaluation: prior?.evaluation || null,
        benchmark: prior?.benchmark || null,
        benchmarkId: String(body.benchmarkId || "").slice(0, 120),
      });
      await audit({ modelId: model.id });
      return res.status(200).json(model);
    }
    if (action === "model.toggle") {
      const m = await repository.get("models", String(body.id));
      if (!m) throw fail(404, "Model not found");
      await repository.patch("models", m.id, {
        enabled: body.enabled === true,
      });
      return res.status(200).json({ ok: true });
    }
    if (action === "model.screen")
      return res
        .status(200)
        .json(await screenModel(repository, String(body.id)));
    if (action === "catalog.refresh") {
      const outcomes = await refreshCatalog(repository);
      await audit({ outcomes });
      return res.status(200).json({ outcomes });
    }
    if (action === "benchmark.key") {
      const key = String(body.key || "").trim();
      if (key.length < 8) throw fail(400, "Enter a valid data API key.");
      await repository.put("settings", "benchmarks", {
        ciphertext: encryptToken(key),
      });
      await audit({ configured: true });
      return res.status(200).json({ ok: true });
    }
    if (action === "benchmark.refresh")
      return res.status(200).json(await refreshBenchmarks(repository));
    if (action === "retrieval.settings") {
      const space = String(body.embeddingSpace || "");
      if (space && !/^[a-zA-Z0-9_.:-]{3,150}$/.test(space))
        throw fail(400, "Invalid embedding space");
      await repository.put("settings", "retrieval", {
        embeddingSpace: space || null,
      });
      return res.status(200).json({ ok: true });
    }
    if (action === "knowledge.upload") {
      if (body.id) uuid(body.id);
      const doc = await uploadDocument(repository, body, uid);
      await audit({ documentId: doc.id });
      return res.status(200).json(safeDoc(doc));
    }
    if (action === "knowledge.preview") {
      const doc = await repository.get("documents", String(body.id));
      if (!doc) throw fail(404, "Document not found");
      return res.status(200).json({
        document: doc,
        chunks: await repository.chunks(doc.id, doc.version),
        versions: (await repository.list("document_versions"))
          .filter((v) => v.documentId === doc.id)
          .map(safeDoc),
      });
    }
    if (action === "knowledge.process")
      return res
        .status(200)
        .json(await processJob(repository, String(body.jobId)));
    if (action === "knowledge.retry") {
      const job = await repository.get("jobs", String(body.jobId));
      if (!job || job.leaseUntil > Date.now())
        throw fail(409, "Job unavailable or still running");
      await repository.patch("jobs", job.id, {
        offset: 0,
        status: "queued",
        leaseUntil: 0,
        warning: null,
      });
      await repository.patch("documents", job.documentId, {
        indexStatus: "queued",
      });
      return res.status(200).json({ ok: true });
    }
    if (action === "knowledge.publish") {
      const d = await repository.get("documents", String(body.id));
      if (!d || !["ready", "keyword_ready"].includes(d.indexStatus))
        throw fail(409, "Finish indexing before publishing.");
      if (d.indexStatus === "keyword_ready" && body.allowKeyword !== true)
        throw fail(
          409,
          "Semantic indexing is unavailable. Explicitly allow keyword-only publication.",
        );
      await repository.patch("documents", d.id, {
        status: "published",
        publishedVersion: d.version,
        publishedEmbeddingSpace: d.embeddingSpace || null,
        publishedAt: new Date().toISOString(),
      });
      await audit({ documentId: d.id });
      return res.status(200).json({ ok: true });
    }
    if (action === "knowledge.rollback") {
      const id = uuid(body.id),
        version = uuid(body.version);
      const saved = await repository.get(
        "document_versions",
        `${id}:${version}`,
      );
      if (!saved || !["ready", "keyword_ready"].includes(saved.indexStatus))
        throw fail(409, "This version is not fully indexed.");
      await repository.patch("documents", id, {
        publishedVersion: version,
        publishedEmbeddingSpace: saved.embeddingSpace || null,
        status: "published",
        publishedAt: new Date().toISOString(),
      });
      await audit({ documentId: id, version });
      return res.status(200).json({ ok: true });
    }
    if (action === "knowledge.archive") {
      await repository.patch("documents", String(body.id), {
        status: "archived",
      });
      await audit({ documentId: body.id });
      return res.status(200).json({ ok: true });
    }
    if (action === "knowledge.search") {
      const query = String(body.query || "")
        .trim()
        .slice(0, 2000);
      if (!query) throw fail(400, "Enter a search query");
      return res
        .status(200)
        .json(
          await retrieve(repository, query, {
            allowPublicProcessing: body.allowPublicProcessing === true,
          }),
        );
    }
    throw fail(400, "Unknown workspace action.");
  };
}
