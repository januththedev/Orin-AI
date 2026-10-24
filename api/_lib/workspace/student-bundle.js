import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { uploadDocument } from "./knowledge.js";
import { fail } from "./repository.js";
let catalogPromise;
const root = new URL("../../../public/student-knowledge/", import.meta.url);
export async function studentCatalog() {
  catalogPromise ||= readFile(new URL("catalog.json", root), "utf8").then(
    JSON.parse,
  );
  return catalogPromise;
}
export async function importStudentBatch(
  repository,
  { offset = 0, limit = 4 } = {},
  actor = "student-library-import",
) {
  const catalog = await studentCatalog();
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= catalog.datasets.length ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 4
  )
    throw fail(400, "Invalid student import batch.");
  const owner = randomUUID();
  if (!(await repository.acquireLease("student-bundle", owner, 120000)))
    throw fail(
      409,
      "Another student import batch is running. Retry in a moment.",
    );
  try {
    return await importLockedBatch(repository, catalog, offset, limit, actor);
  } finally {
    await repository.releaseLease("student-bundle", owner);
  }
}
async function importLockedBatch(repository, catalog, offset, limit, actor) {
  const existing = (await repository.list("documents")).filter(
    (d) => d.status !== "archived",
  );
  const results = [];
  for (const pack of catalog.datasets.slice(offset, offset + limit)) {
    if (!/^(ol|al|general)-[a-z0-9-]+$/.test(pack.id))
      throw fail(500, "Invalid bundled dataset identifier.");
    const markdown = await readFile(new URL(`md/${pack.id}.md`, root), "utf8");
    const hash = createHash("sha256").update(markdown).digest("hex");
    if (hash !== pack.sha256)
      throw fail(500, "Student dataset checksum mismatch. Rebuild the bundle.");
    const source = `https://chat.orinai.org${pack.markdownUrl}`;
    const previous = existing.find(
      (d) => d.studentDatasetId === pack.id || d.source === source,
    );
    if (previous?.hash === hash) {
      results.push({
        id: previous.id,
        datasetId: pack.id,
        result: "unchanged",
      });
      continue;
    }
    const document = await uploadDocument(
      repository,
      {
        ...(previous ? { id: previous.id } : {}),
        title: `${pack.level}: ${pack.title}`,
        markdown,
        language: "en",
        source,
        allowPublicProcessing: false,
      },
      actor,
    );
    const metadata = {
      studentDatasetId: pack.id,
      studentBundleRelease: catalog.release,
      studentReviewStatus: "teacher-review-pending",
    };
    await repository.patch("documents", document.id, metadata);
    await repository.patch(
      "document_versions",
      `${document.id}:${document.version}`,
      metadata,
    );
    existing.push({ ...document, ...metadata });
    results.push({
      id: document.id,
      datasetId: pack.id,
      result: previous ? "updated" : "created",
    });
  }
  return {
    total: catalog.datasets.length,
    processed: results.length,
    next:
      offset + results.length < catalog.datasets.length
        ? offset + results.length
        : null,
    results,
    publication:
      "Drafts only. Review, index and publish in Administration. No embedding provider was called.",
  };
}
