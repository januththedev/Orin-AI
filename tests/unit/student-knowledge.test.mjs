import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  studentCatalog,
  importStudentBatch,
} from "../../api/_lib/workspace/student-bundle.js";
import { MemoryRepository } from "../../api/_lib/workspace/repository.js";
import { chunkMarkdown } from "../../api/_lib/workspace/knowledge.js";
import { createWorkspaceHandler } from "../../api/_lib/workspace/handler.js";
describe("student corpus integrity and safe import", () => {
  it("contains 50 academic and 8 practical packs with 332 original, labelled records", async () => {
    const c = await studentCatalog();
    expect(c.datasets.filter((p) => p.level === "OL")).toHaveLength(20);
    expect(c.datasets.filter((p) => p.level === "AL")).toHaveLength(30);
    expect(c.datasets.filter((p) => p.level === "GENERAL")).toHaveLength(8);
    const rows = c.datasets.flatMap((p) => p.records);
    expect(rows).toHaveLength(332);
    expect(new Set(rows.map((r) => r.id)).size).toBe(332);
    for (const p of c.datasets) {
      expect(p.sourceIds.length).toBeGreaterThan(0);
      for (const id of p.sourceIds)
        expect(c.sources.some((s) => s.id === id)).toBe(true);
      expect(p.scope).toContain("Not a complete syllabus");
      for (const r of p.records) {
        expect(r.answer.length).toBeGreaterThan(80);
        expect(r.reviewStatus).toBe("teacher-review-pending");
        expect(r.origin).toContain("not an official");
      }
    }
  });
  it("checks every Markdown checksum and rejects invalid RAG chunk structures", async () => {
    const c = await studentCatalog();
    for (const p of c.datasets) {
      const md = await readFile(
        new URL(
          `../../public/student-knowledge/md/${p.id}.md`,
          import.meta.url,
        ),
        "utf8",
      );
      expect(createHash("sha256").update(md).digest("hex")).toBe(p.sha256);
      const chunks = chunkMarkdown(md, p.title);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((x) => x.content.length <= 24000)).toBe(true);
    }
  });
  it("imports drafts idempotently, creates version/job records, and preserves a published version", async () => {
    const r = new MemoryRepository();
    const first = await importStudentBatch(
      r,
      { offset: 0, limit: 1 },
      "test-admin",
    );
    const doc = await r.get("documents", first.results[0].id);
    expect(doc.status).toBe("draft");
    expect(doc.language).toBe("en");
    expect(doc.allowPublicProcessing).toBe(false);
    expect(doc.studentReviewStatus).toBe("teacher-review-pending");
    expect(await r.list("jobs")).toHaveLength(1);
    expect(
      await r.get("document_versions", `${doc.id}:${doc.version}`),
    ).toBeTruthy();
    const second = await importStudentBatch(r, { offset: 0, limit: 1 });
    expect(second.results[0].result).toBe("unchanged");
    expect(await r.list("documents")).toHaveLength(1);
    await r.patch("documents", doc.id, {
      status: "published",
      publishedVersion: doc.version,
      hash: "older-content-hash",
    });
    await importStudentBatch(r, { offset: 0, limit: 1 });
    const changed = await r.get("documents", doc.id);
    expect(changed.publishedVersion).toBe(doc.version);
    expect(changed.version).not.toBe(doc.version);
  });
  it("serializes concurrent imports and only lets the lease owner release it", async () => {
    const r = new MemoryRepository();
    expect(await r.acquireLease("student-bundle", "other", 120000)).toBe(true);
    await r.releaseLease("student-bundle", "wrong-owner");
    await expect(
      importStudentBatch(r, { offset: 0, limit: 1 }),
    ).rejects.toMatchObject({ code: 409 });
    await r.releaseLease("student-bundle", "other");
    const results = await Promise.allSettled([
      importStudentBatch(r, { offset: 0, limit: 1 }),
      importStudentBatch(r, { offset: 0, limit: 1 }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await r.list("documents")).toHaveLength(1);
    expect(await r.list("leases")).toHaveLength(0);
  });
  it("bounds server batches and keeps bundle importing behind admin authentication", async () => {
    const r = new MemoryRepository();
    for (const input of [
      { offset: -1 },
      { offset: 58 },
      { offset: 0, limit: 5 },
      { offset: "../../" },
    ])
      await expect(importStudentBatch(r, input)).rejects.toMatchObject({
        code: 400,
      });
    const handler = createWorkspaceHandler({
      repository: r,
      identify: async () => ({ id: "member", role: "member" }),
    });
    await expect(
      handler(
        {
          method: "POST",
          url: "/api/workspace",
          headers: {},
          body: { action: "knowledge.seed", offset: 0 },
        },
        { setHeader() {} },
      ),
    ).rejects.toMatchObject({ code: 403 });
    expect(await r.list("documents")).toHaveLength(0);
  });
});
