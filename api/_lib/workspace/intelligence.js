import { randomUUID } from "node:crypto";
import { decryptToken } from "../crypto.js";
import { ProviderRouter } from "./providers.js";

export function ruleDecision(prompt) {
  return {
    retrieve: !/^\s*(hi|hello|hey|thanks|thank you)[!.\s]*$/i.test(prompt),
    task: /\b(code|debug|sql|javascript|python)\b/i.test(prompt)
      ? "coding"
      : /\b(prove|derive|calculate|equation)\b/i.test(prompt)
        ? "math"
        : "general",
    source: "rules",
  };
}
export async function decide(
  repo,
  prompt,
  routerFactory = () =>
    new ProviderRouter(repo, { deadlineMs: 3500, maxAttempts: 1 }),
  allowPublicProcessing = false,
) {
  const fallback = ruleDecision(prompt);
  try {
    const result = await routerFactory().run(
      "decision",
      {
        allowPublicProcessing,
        state: { question: prompt },
        questions: {
          needs_knowledge: {
            type: "noul",
            instructions:
              "Would relevant reference documents help answer this question? Greetings and casual conversation do not need reference documents.",
          },
          coding: {
            type: "noul",
            instructions: "Is the user asking for software code or debugging?",
          },
        },
      },
      {
        validate: (d) =>
          Number.isFinite(d.answers?.needs_knowledge?.noul) &&
          d.answers.needs_knowledge.noul >= 0 &&
          d.answers.needs_knowledge.noul <= 1 &&
          Number.isFinite(d.answers?.coding?.noul) &&
          d.answers.coding.noul >= 0 &&
          d.answers.coding.noul <= 1,
      },
    );
    const knowledge = result.data.answers.needs_knowledge.noul;
    return {
      retrieve: knowledge > 0.2,
      task: result.data.answers.coding.noul > 0.8 ? "coding" : fallback.task,
      source: "decision_model",
      model: result.model.model,
    };
  } catch {
    return fallback;
  }
}
export async function refreshBenchmarks(repo, fetcher = fetch) {
  const config = await repo.get("settings", "benchmarks");
  const key = decryptToken(config?.ciphertext || "");
  if (!key)
    return {
      ok: false,
      reason: "Add an Artificial Analysis data API key in settings.",
    };
  const res = await fetcher(
    "https://artificialanalysis.ai/api/v2/data/llms/models",
    { headers: { "x-api-key": key }, signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) throw new Error("Benchmark source unavailable");
  const json = await res.json();
  const data = json.data || json;
  if (!Array.isArray(data)) throw new Error("Invalid benchmark response");
  const models = await repo.list("models");
  let matched = 0;
  for (const m of models) {
    if (!m.benchmarkId) continue;
    const record = data.find((d) => d.id === m.benchmarkId);
    const score = record?.evaluations?.artificial_analysis_intelligence_index;
    if (!Number.isFinite(score)) continue;
    matched++;
    await repo.patch("models", m.id, {
      benchmark: {
        score: Math.max(0, Math.min(100, score)),
        rawScore: score,
        source: "Artificial Analysis",
        sourceId: record.id,
        measuredConfiguration:
          "Admin-mapped exact model/version; verify reasoning configuration",
        at: new Date().toISOString(),
      },
    });
  }
  await repo.patch("settings", "benchmarks", {
    refreshedAt: new Date().toISOString(),
    matched,
  });
  return { ok: true, matched, unmapped: models.length - matched };
}
export const SCREENING_CASES = [
  {
    id: "arithmetic",
    prompt: "What is 17 multiplied by 19? Answer with only the number.",
    check: (text) => text.trim() === "323",
  },
  {
    id: "grounding",
    prompt:
      "Use only this reference: The fictional Aruna service closes at 18:15 on Thursday. At what time does it close on Thursday? Answer only HH:MM.",
    check: (text) => text.trim() === "18:15",
  },
  {
    id: "missing",
    prompt:
      "Reference: The fictional Aruna service closes at 18:15 on Thursday. Using only this reference, what is the owner's name? Answer UNKNOWN if the reference does not say.",
    check: (text) => text.trim().toUpperCase() === "UNKNOWN",
  },
  {
    id: "json",
    prompt:
      'Return only a JSON object with exactly one field: "ok" set to boolean true.',
    check: (text) => {
      try {
        const d = JSON.parse(text);
        return d.ok === true && Object.keys(d).length === 1;
      } catch {
        return false;
      }
    },
  },
];
export async function screenModel(
  repo,
  id,
  {
    routerFactory = () =>
      new ProviderRouter(repo, { deadlineMs: 10000, maxAttempts: 1 }),
    oneCase = false,
  } = {},
) {
  const model = await repo.get("models", id);
  if (
    !model ||
    model.service !== "generation" ||
    !["zero", "free_quota"].includes(model.costClass)
  )
    return { skipped: true };
  const saved = await repo.get("screen_progress", id);
  const progress =
    oneCase && saved?.catalogHash === (model.catalogHash || null)
      ? saved?.cases || []
      : [];
  const cases = [...progress];
  const remaining = SCREENING_CASES.filter(
    (t) => !cases.some((c) => c.id === t.id),
  );
  for (const test of oneCase ? remaining.slice(0, 1) : remaining) {
    try {
      const result = await routerFactory().run(
        "generation",
        {
          messages: [{ role: "user", content: test.prompt }],
          max_tokens: 160,
          thinking: false,
          allowPublicProcessing: true,
        },
        {
          modelId: id,
          includeUnscreened: true,
          validate: (d) => typeof d.choices?.[0]?.message?.content === "string",
        },
      );
      const output = result.data.choices[0].message.content;
      cases.push({ id: test.id, passed: test.check(output) });
    } catch {
      cases.push({ id: test.id, passed: false });
    }
  }
  if (oneCase && cases.length < SCREENING_CASES.length) {
    await repo.put("screen_progress", id, {
      cases,
      catalogHash: model.catalogHash || null,
    });
    return { pending: true, completed: cases.length };
  }
  await repo.delete("screen_progress", id);
  const score = (100 * cases.filter((c) => c.passed).length) / cases.length;
  const evaluation = {
    score,
    kind: "screening",
    cases,
    at: new Date().toISOString(),
    note: "Small synthetic screening suite. Not a broad accuracy benchmark.",
  };
  await repo.patch("models", id, {
    evaluation,
    status: score >= 75 ? "eligible" : "discovered",
  });
  await repo.put("evaluations", randomUUID(), {
    id: randomUUID(),
    modelId: id,
    ...evaluation,
  });
  return evaluation;
}
