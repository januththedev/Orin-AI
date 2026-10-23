import { randomUUID, createHash } from "node:crypto";
import { encryptToken, decryptToken } from "../crypto.js";
import { fail } from "./repository.js";

export const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    services: ["generation", "embedding", "rerank", "decision"],
  },
  groq: {
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    services: ["generation"],
  },
  vercel: {
    label: "Vercel AI Gateway",
    base: "https://ai-gateway.vercel.sh/v1",
    services: ["generation"],
  },
  nim: {
    label: "NVIDIA NIM",
    base: "https://integrate.api.nvidia.com/v1",
    services: ["embedding", "rerank"],
  },
};
export function publicCredential(c) {
  const { ciphertext, ...safe } = c;
  return safe;
}
export async function saveCredential(repo, input) {
  const provider = String(input.provider);
  if (!PROVIDERS[provider]) throw fail(400, "Unsupported provider.");
  const key = String(input.key || "").trim();
  if (key.length < 8 || key.length > 1000)
    throw fail(400, "Enter a valid API key.");
  const id = randomUUID();
  const credential = {
    id,
    provider,
    label: String(input.label || PROVIDERS[provider].label).slice(0, 80),
    quotaPool: String(input.quotaPool || provider).slice(0, 80),
    ciphertext: encryptToken(key),
    masked: `••••${key.slice(-4)}`,
    enabled: true,
    health: "untested",
    cooldownUntil: 0,
    createdAt: new Date().toISOString(),
  };
  await repo.put("credentials", id, credential);
  return publicCredential(credential);
}
export function classifyError(status, body, retryAfter) {
  const seconds = Number(retryAfter);
  const until = Number.isFinite(seconds)
    ? Date.now() + Math.min(3600, Math.max(1, seconds)) * 1000
    : Date.parse(retryAfter || "");
  if (status === 401) return { kind: "credential", disable: true };
  if (status === 402)
    return { kind: "quota", pool: true, cooldownUntil: Date.now() + 3600000 };
  if (status === 429)
    return {
      kind: "rate_limit",
      pool: true,
      cooldownUntil: Number.isFinite(until) ? until : Date.now() + 60000,
    };
  if (status === 403)
    return { kind: "permission", cooldownUntil: Date.now() + 60000 };
  if (status === 404)
    return { kind: "model_removed", cooldownUntil: Date.now() + 60000 };
  if (status === 408 || status >= 500)
    return { kind: "transient", cooldownUntil: Date.now() + 30000 };
  if (status === 400 || status === 422)
    return { kind: "request", retry: false };
  return { kind: "invalid_response", cooldownUntil: Date.now() + 30000 };
}
function normalizePrice(v) {
  const n = Number(v);
  return v !== undefined &&
    v !== null &&
    v !== "" &&
    Number.isFinite(n) &&
    n >= 0
    ? n
    : null;
}
export function normalizeModel(provider, m) {
  const pricing = m.pricing || {};
  const input = normalizePrice(pricing.prompt ?? pricing.input);
  const output = normalizePrice(pricing.completion ?? pricing.output);
  const modalities = m.architecture?.output_modalities ||
    m.output_modalities || ["text"];
  const kind =
    modalities.includes("embeddings") || modalities.includes("embedding")
      ? "embedding"
      : modalities.includes("rerank")
        ? "rerank"
        : modalities.includes("decisions")
          ? "decision"
          : "generation";
  const supported = m.supported_parameters || [];
  return {
    id: `${provider}:${m.id}`,
    provider,
    model: m.id,
    label: m.name || m.id,
    service: kind,
    context: Number(m.context_length || m.context_window || 0),
    reasoning:
      supported.includes("reasoning") ||
      supported.includes("include_reasoning"),
    inputPrice: input,
    outputPrice: output,
    costClass:
      input === 0 && (kind !== "generation" || output === 0)
        ? "zero"
        : "unknown",
    enabled: true,
    status: "discovered",
    stealth: /stealth|alpha|anonymous/i.test(`${m.id} ${m.name || ""}`),
    discoveredAt: new Date().toISOString(),
    capabilities: m.architecture?.input_modalities || ["text"],
    benchmark: null,
    evaluation: null,
    publicDataOnly: provider === "openrouter" && /^nvidia\//.test(m.id),
    catalogHash: createHash("sha256")
      .update(
        JSON.stringify({
          id: m.id,
          context: m.context_length,
          parameters: supported,
          pricing,
          architecture: m.architecture,
        }),
      )
      .digest("hex"),
  };
}
export function modelScore(m, thinking = false) {
  const local = Number.isFinite(m.evaluation?.score)
    ? m.evaluation.score
    : null;
  const external = Number.isFinite(m.benchmark?.score)
    ? m.benchmark.score
    : null;
  // Missing measurements are uncertainty, never fabricated capability.
  const quality = local === null ? 0 : local;
  const intel = external === null ? 0 : external;
  const reliability = m.calls ? 100 * (1 - (m.failures || 0) / m.calls) : 50;
  const speed = m.latencyMs ? Math.max(0, 100 - m.latencyMs / 200) : 25;
  return (
    (thinking ? 0.45 : 0.35) * quality +
    (thinking ? 0.3 : 0.2) * intel +
    (thinking ? 0.05 : 0.25) * speed +
    0.15 * reliability +
    0.05 * (m.quotaHeadroom ?? 50) -
    (local === null ? 10 : 0) -
    (external === null ? 5 : 0)
  );
}
export function eligible(m, service, thinking = false) {
  return (
    m.enabled &&
    m.service === service &&
    m.status === "eligible" &&
    ["zero", "free_quota"].includes(m.costClass) &&
    (!thinking || m.reasoning) &&
    Number(m.cooldownUntil || 0) < Date.now()
  );
}

export class ProviderRouter {
  constructor(
    repo,
    { fetcher = fetch, deadlineMs = 45000, maxAttempts = 3, demo = false } = {},
  ) {
    this.repo = repo;
    this.fetcher = repo.localDemo
      ? async () => {
          throw new Error("Live provider calls are disabled in the local demo");
        }
      : fetcher;
    this.deadline = Date.now() + deadlineMs;
    this.maxAttempts = maxAttempts;
    this.demo = demo;
    this.attempts = [];
  }
  async run(
    service,
    payload,
    {
      thinking = false,
      space,
      modelId,
      includeUnscreened = false,
      onDelta,
      validate = () => true,
    } = {},
  ) {
    const models = (await this.repo.list("models"))
      .filter(
        (m) =>
          (eligible(m, service, thinking) ||
            (includeUnscreened &&
              m.enabled &&
              m.service === service &&
              ["zero", "free_quota"].includes(m.costClass))) &&
          (!space || m.embeddingSpace === space) &&
          (!modelId || m.id === modelId),
      )
      .filter(
        (m) => !m.publicDataOnly || payload.allowPublicProcessing === true,
      )
      .filter(
        (m) =>
          service !== "generation" ||
          m.context >=
            Math.ceil(JSON.stringify(payload.messages || []).length / 3) +
              Number(payload.max_tokens || 0),
      )
      .sort((a, b) => modelScore(b, thinking) - modelScore(a, thinking));
    const keys = await this.repo.list("credentials");
    const blockedPools = new Set();
    const blockedCredentials = new Set();
    let count = 0;
    let requestInvalid = false;
    for (const model of models) {
      if (requestInvalid) break;
      const credentials = keys
        .filter(
          (c) =>
            c.provider === model.provider &&
            c.enabled &&
            Number(c.cooldownUntil || 0) < Date.now(),
        )
        .sort(
          (a, b) =>
            (a.health === "healthy" ? -1 : 0) -
            (b.health === "healthy" ? -1 : 0),
        );
      for (const credential of credentials) {
        if (count >= this.maxAttempts || Date.now() >= this.deadline) break;
        if (
          blockedCredentials.has(credential.id) ||
          blockedPools.has(`${credential.provider}:${credential.quotaPool}`)
        )
          continue;
        count++;
        const started = Date.now();
        let response,
          classification,
          emittedText = "";
        try {
          const secret = decryptToken(credential.ciphertext);
          if (!secret)
            throw Object.assign(
              new Error("Credential could not be decrypted"),
              { credentialError: true },
            );
          const result = await this.invoke(
            model,
            secret,
            { ...payload, ...(onDelta ? { stream: true } : {}) },
            Math.min(30000, this.deadline - Date.now()),
          );
          response = result.response;
          if (!response.ok) {
            classification = classifyError(
              response.status,
              result.data,
              response.headers.get("retry-after"),
            );
            throw new Error("Provider request failed");
          }
          if (onDelta && service === "generation" && response.ok)
            result.data = await consumeGeneration(response, (delta) => {
              emittedText += delta;
              onDelta(delta);
            });
          if (!validate(result.data))
            throw new Error("Provider returned an invalid response");
          this.attempts.push({
            provider: model.provider,
            model: model.model,
            credentialId: credential.id,
            outcome: "success",
            ms: Date.now() - started,
          });
          await this.repo
            .patch("credentials", credential.id, {
              health: "healthy",
              lastUsedAt: new Date().toISOString(),
            })
            .catch(() => {});
          await this.repo
            .patch("models", model.id, {
              calls: (model.calls || 0) + 1,
              latencyMs: Date.now() - started,
            })
            .catch(() => {});
          return { data: result.data, model, attempts: this.attempts };
        } catch (error) {
          if (error.streamStarted || emittedText)
            throw Object.assign(
              fail(
                502,
                "The provider interrupted this answer. Retry to generate a new answer.",
              ),
              {
                partialText: error.partialText || emittedText,
                streamStarted: true,
                attempts: this.attempts,
              },
            );
          classification ||= error.credentialError
            ? { kind: "credential", disable: true }
            : classifyError(503, {}, null);
          this.attempts.push({
            provider: model.provider,
            model: model.model,
            credentialId: credential.id,
            outcome: classification.kind,
            ms: Date.now() - started,
          });
          await this.repo.patch("models", model.id, {
            calls: (model.calls || 0) + 1,
            failures: (model.failures || 0) + 1,
          });
          if (classification.disable || classification.kind === "transient")
            blockedCredentials.add(credential.id);
          if (classification.disable)
            await this.repo.patch("credentials", credential.id, {
              enabled: false,
              health: "invalid",
            });
          if (classification.pool) {
            const poolKey = `${credential.provider}:${credential.quotaPool}`;
            blockedPools.add(poolKey);
            for (const c of keys.filter(
              (c) =>
                c.provider === credential.provider &&
                c.quotaPool === credential.quotaPool,
            ))
              await this.repo.patch("credentials", c.id, {
                health: classification.kind,
                cooldownUntil: classification.cooldownUntil,
              });
          }
          if (
            classification.kind === "permission" ||
            classification.kind === "model_removed"
          )
            await this.repo.patch("models", model.id, {
              cooldownUntil: classification.cooldownUntil,
            });
          if (classification.kind === "transient")
            await this.repo.patch("credentials", credential.id, {
              health: "degraded",
              cooldownUntil: classification.cooldownUntil,
            });
          if (classification.retry === false) {
            requestInvalid = true;
            break;
          }
        }
      }
    }
    throw Object.assign(
      fail(
        503,
        requestInvalid
          ? "The selected provider rejected the request format. Review its model configuration."
          : "No eligible free capacity is available. Check provider keys, models, or try again shortly.",
      ),
      { attempts: this.attempts },
    );
  }
  async invoke(model, key, payload, timeout) {
    const base = PROVIDERS[model.provider]?.base;
    if (!base) throw fail(400, "Unsupported provider");
    let url, body;
    if (model.service === "generation") {
      url = `${base}/chat/completions`;
      body = {
        ...payload,
        model: model.model,
        stream: payload.stream === true,
        ...(model.provider === "openrouter"
          ? {
              provider: {
                allow_fallbacks: false,
                max_price: { prompt: 0, completion: 0 },
              },
            }
          : {}),
        ...(model.reasoning
          ? {
              reasoning: {
                enabled: !!payload.thinking,
                ...(payload.thinking ? { max_tokens: 4096 } : {}),
              },
            }
          : {}),
      };
      delete body.thinking;
      delete body.allowPublicProcessing;
    }
    if (model.service === "embedding") {
      url = `${base}/embeddings`;
      body = {
        model: model.model,
        input: payload.input,
        encoding_format: "float",
        ...(model.provider === "nim"
          ? {
              input_type: payload.inputType === "query" ? "query" : "passage",
              truncate: "END",
            }
          : {}),
        ...(model.dimensions ? { dimensions: model.dimensions } : {}),
      };
    }
    if (model.service === "rerank") {
      url =
        model.provider === "nim"
          ? "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking"
          : `${base}/rerank`;
      body =
        model.provider === "nim"
          ? {
              model: model.model,
              query: { text: payload.query },
              passages: payload.documents.map((text) => ({ text })),
              truncate: "END",
            }
          : {
              model: model.model,
              query: payload.query,
              documents: payload.documents,
              top_n: payload.documents.length,
            };
    }
    if (model.service === "decision") {
      if (model.provider !== "openrouter")
        throw fail(400, "Decision adapter unavailable");
      url = "https://openrouter.ai/api/alpha/decisions";
      body = { model: model.model, ...payload };
      delete body.allowPublicProcessing;
    }
    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://chat.orinai.org",
        "X-Title": "Orin Chat",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, timeout)),
    });
    const data =
      model.service === "generation" && payload.stream && response.ok
        ? null
        : await response.json().catch(() => ({}));
    return { response, data };
  }
}
export async function refreshCatalog(repo, fetcher = fetch) {
  const credentials = await repo.list("credentials");
  const previous = await repo.list("models");
  const outcomes = [];
  for (const [provider, config] of Object.entries(PROVIDERS)) {
    const key = credentials.find(
      (c) =>
        c.provider === provider &&
        c.enabled &&
        Number(c.cooldownUntil || 0) < Date.now(),
    );
    if (!key) continue;
    try {
      const response = await fetcher(`${config.base}/models`, {
        headers: { authorization: `Bearer ${decryptToken(key.ciphertext)}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Catalog unavailable");
      const data = await response.json();
      if (!Array.isArray(data.data)) throw new Error("Invalid catalog");
      const seen = new Set();
      for (const m of data.data) {
        if (!m.id || ["openrouter/free", "openrouter/auto"].includes(m.id))
          continue;
        const next = normalizeModel(provider, m);
        const old = previous.find((p) => p.id === next.id);
        seen.add(next.id);
        // Keep manually reviewed capability/cost policy; revoked zero pricing blocks eligibility.
        const merged = {
          ...next,
          ...old,
          label: next.label,
          lastSeenAt: new Date().toISOString(),
          ...(next.inputPrice !== null
            ? { inputPrice: next.inputPrice, outputPrice: next.outputPrice }
            : {}),
          ...(old?.costClass === "zero" && next.costClass !== "zero"
            ? { costClass: "unknown", status: "discovered" }
            : {}),
        };
        if (!old && next.costClass === "zero") merged.status = "discovered";
        if (old?.catalogHash && old.catalogHash !== next.catalogHash) {
          merged.evaluation = null;
          merged.status = "discovered";
        }
        merged.catalogHash = next.catalogHash;
        await repo.put("models", next.id, merged);
      }
      for (const old of previous.filter(
        (m) => m.provider === provider && !seen.has(m.id),
      ))
        await repo.patch("models", old.id, { status: "unavailable" });
      outcomes.push({ provider, count: seen.size, ok: true });
    } catch {
      outcomes.push({
        provider,
        ok: false,
        error: "Catalog refresh failed; previous snapshot retained.",
      });
    }
  }
  await repo.put("settings", "catalog", {
    id: "catalog",
    refreshedAt: new Date().toISOString(),
    outcomes,
  });
  return outcomes;
}
export function validateModel(input) {
  const provider = String(input.provider);
  const service = String(input.service);
  const model = String(input.model || "").trim();
  if (!PROVIDERS[provider]?.services.includes(service))
    throw fail(400, "This provider does not support the selected service.");
  if (!/^[a-zA-Z0-9_./:@-]{2,200}$/.test(model))
    throw fail(400, "Enter a valid model ID.");
  const costClass = String(input.costClass || "unknown");
  if (!["zero", "free_quota", "unknown"].includes(costClass))
    throw fail(400, "Only free models and free quota pools can be configured.");
  const dimensions = Number(input.dimensions) || null;
  if (
    service === "embedding" &&
    (!dimensions || dimensions < 1 || dimensions > 4096)
  )
    throw fail(400, "Embedding dimensions must be between 1 and 4096.");
  const embeddingSpace =
    service === "embedding" ? String(input.embeddingSpace || "").trim() : null;
  if (
    service === "embedding" &&
    !/^[a-zA-Z0-9_.:-]{3,150}$/.test(embeddingSpace)
  )
    throw fail(
      400,
      "Set a stable embedding space ID shared only by compatible models.",
    );
  return {
    id: `${provider}:${model}`,
    provider,
    model,
    label: String(input.label || model).slice(0, 120),
    service,
    costClass,
    context: Math.max(1024, Math.min(2000000, Number(input.context) || 8192)),
    reasoning: input.reasoning === true,
    enabled: input.enabled !== false,
    status:
      input.eligible === true && costClass !== "unknown"
        ? "eligible"
        : "discovered",
    embeddingSpace,
    dimensions,
    stealth: /alpha|stealth|anonymous/i.test(model),
    discoveredAt: new Date().toISOString(),
    benchmark: null,
    evaluation: null,
    publicDataOnly:
      input.publicDataOnly === true ||
      (provider === "openrouter" && /^nvidia\//.test(model)),
  };
}

/** Parse upstream SSE while retaining partial text on interruption. Never splice providers. */
export async function consumeGeneration(response, onDelta) {
  if (!response.body) throw new Error("Missing provider stream");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    content = "",
    finished = false,
    finishReason = null;
  try {
    const consume = (part) => {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") {
          finished = true;
          continue;
        }
        if (!raw) continue;
        const event = JSON.parse(raw);
        if (event.error) throw new Error("Provider stream error");
        const choice = event.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta) {
          content += delta;
          if (content.length > 100000)
            throw new Error("Provider response exceeds limit");
          onDelta(delta);
        }
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 250000) throw new Error("Malformed provider stream");
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      for (const part of parts) consume(part);
      if (finished) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!finished && !finishReason)
      throw new Error("Provider stream ended unexpectedly");
    if (!content.trim()) throw new Error("Provider returned an empty answer");
    return {
      choices: [
        { message: { content }, finish_reason: finishReason || "stop" },
      ],
    };
  } catch (error) {
    throw Object.assign(error, {
      partialText: content,
      streamStarted: content.length > 0,
    });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
