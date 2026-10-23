import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryRepository } from "../../api/_lib/workspace/repository.js";
import {
  ProviderRouter,
  saveCredential,
  validateModel,
  eligible,
  modelScore,
} from "../../api/_lib/workspace/providers.js";
import {
  uploadDocument,
  processJob,
  retrieve,
  validRerank,
  chunkMarkdown,
} from "../../api/_lib/workspace/knowledge.js";
import {
  answer,
  buildMessages,
  citationCheck,
} from "../../api/_lib/workspace/chat.js";
import { createWorkspaceHandler } from "../../api/_lib/workspace/handler.js";
process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-not-for-production-000";
let repo;
beforeEach(() => {
  repo = new MemoryRepository();
});
async function model(
  provider = "openrouter",
  service = "generation",
  extra = {},
) {
  const m = validateModel({
    provider,
    service,
    model: "test-model",
    costClass: "zero",
    eligible: true,
    context: 32768,
    dimensions: 3,
    embeddingSpace: "test-space",
    ...extra,
  });
  await repo.put("models", m.id, m);
  return m;
}
async function key(provider = "openrouter", quotaPool = "default") {
  return saveCredential(repo, {
    provider,
    key: "test-api-secret-" + randomUUID(),
    quotaPool,
  });
}
const ok = (d) =>
  new Response(JSON.stringify(d), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const completion = { choices: [{ message: { content: "A valid answer." } }] };

describe("provider failover", () => {
  it("disables an invalid key and uses another valid key", async () => {
    const a = await key(),
      b = await key();
    await model();
    let calls = 0;
    const router = new ProviderRouter(repo, {
      fetcher: async () =>
        ++calls === 1 ? new Response("{}", { status: 401 }) : ok(completion),
    });
    const result = await router.run(
      "generation",
      { messages: [], max_tokens: 20 },
      { validate: (d) => !!d.choices },
    );
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      "credential",
      "success",
    ]);
    expect((await repo.get("credentials", a.id)).enabled).toBe(false);
    expect((await repo.get("credentials", b.id)).enabled).toBe(true);
  });
  it("does not retry another key sharing an exhausted quota pool", async () => {
    await key();
    await key();
    await key("groq");
    await model();
    await model("groq");
    const providers = [];
    const router = new ProviderRouter(repo, {
      fetcher: async (url) => {
        providers.push(url);
        return url.includes("openrouter")
          ? new Response("{}", {
              status: 429,
              headers: { "retry-after": "60" },
            })
          : ok(completion);
      },
    });
    await router.run("generation", { messages: [], max_tokens: 20 });
    expect(providers).toHaveLength(2);
    expect(providers[1]).toContain("groq");
  });
  it("never calls a model with unknown pricing or insufficient context", async () => {
    await key();
    await model("openrouter", "generation", { costClass: "unknown" });
    let calls = 0;
    await expect(
      new ProviderRouter(repo, {
        fetcher: async () => {
          calls++;
          return ok(completion);
        },
      }).run("generation", { messages: [], max_tokens: 20 }),
    ).rejects.toMatchObject({ code: 503 });
    expect(calls).toBe(0);
  });
  it("fails over between models and providers, but obeys Thinking capability", async () => {
    await key();
    await key("groq");
    await model();
    const best = await model("groq", "generation", { reasoning: true });
    const r = await new ProviderRouter(repo, {
      fetcher: async () => ok(completion),
    }).run("generation", { messages: [], max_tokens: 20 }, { thinking: true });
    expect(r.model.id).toBe(best.id);
  });
  it("does not treat missing evaluation scores as a high benchmark", async () => {
    const a = await model();
    expect(
      modelScore({ ...a, evaluation: { score: 90 }, benchmark: { score: 80 } }),
    ).toBeGreaterThan(modelScore(a));
  });
  it("rejects unsupported provider/service combinations", () =>
    expect(() =>
      validateModel({ provider: "groq", service: "embedding", model: "x" }),
    ).toThrow());
});

describe("published knowledge boundary", () => {
  it("requires indexing before publishing and excludes drafts and archived data", async () => {
    const d = await uploadDocument(
      repo,
      { title: "Saturn notes", markdown: "# Saturn\n\nSaturn has rings." },
      "admin",
    );
    expect((await retrieve(repo, "Saturn")).sources).toHaveLength(0);
    const job = (await repo.list("jobs"))[0];
    await processJob(repo, job.id);
    expect((await repo.get("documents", d.id)).indexStatus).toBe(
      "keyword_ready",
    );
    await repo.patch("documents", d.id, {
      status: "published",
      publishedVersion: d.version,
    });
    expect((await retrieve(repo, "Saturn")).sources[0].content).toContain(
      "rings",
    );
    await repo.patch("documents", d.id, { status: "archived" });
    expect((await retrieve(repo, "Saturn")).sources).toHaveLength(0);
  });
  it("rejects duplicate documents and oversized sections", async () => {
    await uploadDocument(
      repo,
      { markdown: "# Test\n\nA unique paragraph." },
      "a",
    );
    await expect(
      uploadDocument(repo, { markdown: "# Test\n\nA unique paragraph." }, "a"),
    ).rejects.toMatchObject({ code: 409 });
    expect(() => chunkMarkdown("x".repeat(25000))).toThrow();
  });
  it("never calls an incompatible embedding model", async () => {
    await key();
    await model("openrouter", "embedding", { embeddingSpace: "other-space" });
    let calls = 0;
    await expect(
      new ProviderRouter(repo, {
        fetcher: async () => {
          calls++;
          return ok({});
        },
      }).run("embedding", { input: ["hello"] }, { space: "expected-space" }),
    ).rejects.toMatchObject({ code: 503 });
    expect(calls).toBe(0);
  });
  it("rejects malformed rerank indexes instead of returning wrong documents", () => {
    expect(
      validRerank({ results: [{ index: 5, relevance_score: 1 }] }, 2),
    ).toBe(false);
    expect(
      validRerank(
        {
          results: [
            { index: 0, relevance_score: 1 },
            { index: 0, relevance_score: 0.5 },
          ],
        },
        2,
      ),
    ).toBe(false);
  });
  it("does not store mismatched embedding dimensions", async () => {
    const doc = await uploadDocument(
      repo,
      { markdown: "# Saturn\n\nSaturn has rings." },
      "a",
    );
    await model("openrouter", "embedding", { dimensions: 3 });
    await processJob(repo, (await repo.list("jobs"))[0].id, {
      routerFactory: () => ({
        run: async () => ({
          model: { dimensions: 3 },
          data: { data: [{ index: 0, embedding: [1, 2] }] },
        }),
      }),
    });
    const chunk = (await repo.chunks(doc.id, doc.version))[0];
    expect(chunk.embedding).toBeNull();
  });
});

describe("account and history isolation", () => {
  it("keeps conversations and messages isolated, including ID collisions", async () => {
    const id = randomUUID();
    await repo.createConversation("a", id, "Private", false);
    await expect(
      repo.createConversation("b", id, "Stolen", false),
    ).rejects.toMatchObject({ code: 404 });
    await expect(repo.messages("b", id)).rejects.toMatchObject({ code: 404 });
    expect((await repo.conversations("b")).items).toEqual([]);
  });
  it("persists answers once and returns an idempotent replay", async () => {
    const account = await repo.account("a", { name: "Test" });
    const input = {
      prompt: "hello",
      conversationId: randomUUID(),
      requestId: randomUUID(),
    };
    const a = await answer(repo, account, input, { demo: true });
    const b = await answer(repo, account, input, { demo: true });
    expect(a).toEqual(b);
    expect((await repo.messages("a", input.conversationId)).items).toHaveLength(
      2,
    );
  });
  it("stores failed generations and the user message for recovery", async () => {
    const account = await repo.account("a", {});
    const input = {
      prompt: "hello",
      conversationId: randomUUID(),
      requestId: randomUUID(),
    };
    await expect(answer(repo, account, input)).rejects.toMatchObject({
      code: 503,
    });
    const msgs = (await repo.messages("a", input.conversationId)).items;
    expect(msgs.find((m) => m.role === "user").content).toBe("hello");
    expect(msgs.find((m) => m.role === "assistant").status).toBe("failed");
  });
  it("lists more than one page without losing records", async () => {
    for (let i = 0; i < 65; i++)
      await repo.createConversation("a", randomUUID(), `Chat ${i}`, false);
    const first = await repo.conversations("a");
    const second = await repo.conversations("a", { cursor: first.next });
    const third = await repo.conversations("a", { cursor: second.next });
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map((c) => c.id),
      ).size,
    ).toBe(65);
  });
  it("places real retrieved evidence in the system context and validates references", () => {
    const source = {
      index: 1,
      title: "Test",
      section: "Facts",
      content: "The unique answer is 42.",
    };
    expect(buildMessages("Question", [], [source], false)[0].content).toContain(
      "The unique answer is 42.",
    );
    expect(citationCheck("Answer [1] and [99]", [source])).toEqual({
      invalid: [99],
      cited: [1],
    });
  });
  it("protects administration on the server", async () => {
    const handler = createWorkspaceHandler({
      repository: repo,
      identify: async () => ({ id: "member", role: "member" }),
    });
    const req = {
      method: "POST",
      url: "/api/workspace",
      headers: {},
      body: {
        action: "provider.add",
        provider: "openrouter",
        key: "secret-test",
      },
    };
    const res = {
      setHeader() {},
      status() {
        return this;
      },
      json() {
        return this;
      },
    };
    await expect(handler(req, res)).rejects.toMatchObject({ code: 403 });
    expect(await repo.list("credentials")).toHaveLength(0);
  });
  it("ignores caller-supplied demo flags and fails closed without authentication", async () => {
    const handler = createWorkspaceHandler({ repository: repo });
    const req = {
      method: "POST",
      url: "/api/workspace",
      headers: {},
      body: { action: "bootstrap", demo: true },
    };
    const res = { setHeader() {} };
    await expect(handler(req, res)).rejects.toMatchObject({ code: 503 });
  });
});

describe("streaming and model policy", () => {
  const stream = (parts) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const part of parts)
            controller.enqueue(new TextEncoder().encode(part));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  it("streams real content deltas and completes the same answer", async () => {
    await key();
    await model();
    const deltas = [];
    const router = new ProviderRouter(repo, {
      fetcher: async () =>
        stream([
          'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        ]),
    });
    const r = await router.run(
      "generation",
      { messages: [], max_tokens: 20 },
      { onDelta: (d) => deltas.push(d), validate: (d) => !!d.choices },
    );
    expect(deltas).toEqual(["Hello ", "world"]);
    expect(r.data.choices[0].message.content).toBe("Hello world");
  });
  it("does not splice a new provider into an interrupted streamed answer", async () => {
    await key();
    await key("groq");
    await model();
    await model("groq");
    let calls = 0;
    const r = new ProviderRouter(repo, {
      fetcher: async () => {
        calls++;
        return stream([
          'data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n',
        ]);
      },
    });
    await expect(
      r.run(
        "generation",
        { messages: [], max_tokens: 20 },
        { onDelta: () => {} },
      ),
    ).rejects.toMatchObject({
      streamStarted: true,
      partialText: "Partial answer",
    });
    expect(calls).toBe(1);
  });
  it("requires explicit public-data opt-in for restricted models", async () => {
    await key();
    await model("openrouter", "generation", { publicDataOnly: true });
    let calls = 0;
    const factory = () =>
      new ProviderRouter(repo, {
        fetcher: async () => {
          calls++;
          return ok(completion);
        },
      });
    await expect(
      factory().run("generation", { messages: [], max_tokens: 20 }),
    ).rejects.toMatchObject({ code: 503 });
    expect(calls).toBe(0);
    await factory().run("generation", {
      messages: [],
      max_tokens: 20,
      allowPublicProcessing: true,
    });
    expect(calls).toBe(1);
  });
  it("keeps fenced code blocks intact across blank lines", () => {
    const code = "```js\nconst x = 1;\n\nconst y = 2;\n```";
    const chunks = chunkMarkdown("# Example\n\n" + code + "\n\nA note.");
    expect(chunks.some((c) => c.content.includes(code))).toBe(true);
  });
});

describe("document version publication", () => {
  it("retains the published version while a replacement is being indexed", async () => {
    const a = await uploadDocument(
      repo,
      { title: "Facts", markdown: "# Saturn\n\nSaturn has rings." },
      "admin",
    );
    await processJob(repo, (await repo.list("jobs"))[0].id);
    await repo.patch("documents", a.id, {
      status: "published",
      publishedVersion: a.version,
    });
    const b = await uploadDocument(
      repo,
      {
        id: a.id,
        title: "Facts updated",
        markdown: "# Saturn\n\nSaturn is a gas giant.",
      },
      "admin",
    );
    expect(b.version).not.toBe(a.version);
    expect(b.publishedVersion).toBe(a.version);
    expect((await retrieve(repo, "rings")).sources[0].content).toContain(
      "rings",
    );
    expect((await retrieve(repo, "gas giant")).sources).toHaveLength(0);
  });
});
