import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { Repository } from "../../api/_lib/workspace/repository.js";
let db, repo;
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(
    await readFile(
      new URL("../../api/_lib/workspace/schema.sql", import.meta.url),
      "utf8",
    ),
  );
  repo = new Repository(async (text, values = []) => {
    const r = await db.query(text, values);
    return r.rows;
  });
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("real Postgres workspace queries", () => {
  it("applies the migration idempotently", async () => {
    await db.exec(
      await readFile(
        new URL("../../api/_lib/workspace/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      (
        await db.query(
          "SELECT extname FROM pg_extension WHERE extname='vector'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("persists accounts, messages, requests, and cursor history without blob overwrites", async () => {
    const user = await repo.account("user_a", { name: "User A" }, true);
    const id = randomUUID(),
      requestId = randomUUID();
    await repo.createConversation(user.id, id, "Database test", true);
    expect(await repo.claimRequest(user.id, requestId, id)).toBe(true);
    expect(await repo.claimRequest(user.id, requestId, id)).toBe(false);
    await repo.message({
      id: randomUUID(),
      account_id: user.id,
      conversation_id: id,
      request_id: requestId,
      role: "user",
      content: "Remember me",
      status: "complete",
    });
    await repo.message({
      id: randomUUID(),
      account_id: user.id,
      conversation_id: id,
      request_id: requestId,
      role: "assistant",
      content: "Remembered",
      status: "complete",
    });
    await repo.finishRequest(user.id, requestId, "complete", {
      text: "Remembered",
    });
    expect((await repo.messages(user.id, id)).items).toHaveLength(2);
    expect((await repo.request(user.id, requestId)).response.text).toBe(
      "Remembered",
    );
    await expect(repo.messages("other", id)).rejects.toMatchObject({
      code: 404,
    });
    const page = await repo.conversations(user.id, { limit: 1 });
    expect(page.items[0].title).toBe("Database test");
    await repo.updateConversation(user.id, id, { title: "Renamed" });
    expect((await repo.conversation(user.id, id)).title).toBe("Renamed");
  });
  it("atomically leases a job once and applies an API rate window", async () => {
    const id = randomUUID();
    await repo.put("jobs", id, { id, status: "queued", leaseUntil: 0 });
    expect(await repo.leaseJob(id, "a")).toBeTruthy();
    expect(await repo.leaseJob(id, "b")).toBeNull();
    expect(await repo.rate("test", 2, 60000)).toBe(true);
    expect(await repo.rate("test", 2, 60000)).toBe(true);
    expect(await repo.rate("test", 2, 60000)).toBe(false);
  });
  it("combines published-only full text and compatible vector search", async () => {
    const doc = randomUUID(),
      version = randomUUID();
    await repo.put("documents", doc, {
      id: doc,
      status: "published",
      publishedVersion: version,
    });
    await repo.addChunks([
      {
        id: randomUUID(),
        document_id: doc,
        version,
        ordinal: 0,
        title: "Saturn",
        section: "Rings",
        content: "Saturn has beautiful rings.",
        embedding_space: "three-dim",
        embedding: [1, 0, 0],
      },
      {
        id: randomUUID(),
        document_id: doc,
        version,
        ordinal: 1,
        title: "Different space",
        section: "Incompatible",
        content: "This has another dimension.",
        embedding_space: "two-dim",
        embedding: [1, 0],
      },
    ]);
    const results = await repo.retrieve("Saturn", [1, 0, 0], "three-dim");
    expect(results.keyword[0].content).toContain("rings");
    expect(results.vector).toHaveLength(1);
    await repo.patch("documents", doc, { status: "archived" });
    expect(
      (await repo.retrieve("Saturn", [1, 0, 0], "three-dim")).vector,
    ).toHaveLength(0);
  });
});
