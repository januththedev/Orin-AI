import { randomUUID, createHash } from "node:crypto";
import { refreshCatalog } from "./providers.js";
import { refreshBenchmarks, screenModel } from "./intelligence.js";
import { processJob } from "./knowledge.js";

export async function enqueueScheduledJobs(repo) {
  const settings = [
    ["catalog-sync", "catalog", 30 * 60 * 1000],
    ["benchmark-sync", "benchmarks", 12 * 3600 * 1000],
  ];
  for (const [id, type, interval] of settings) {
    const old = await repo.get("jobs", id);
    if (!old)
      await repo.put("jobs", id, {
        id,
        type,
        status: "queued",
        leaseUntil: 0,
        createdAt: new Date().toISOString(),
      });
    else if (
      ["complete", "failed"].includes(old.status) &&
      Date.now() - Number(old.finishedAt || 0) > interval
    )
      await repo.patch("jobs", id, { status: "queued", leaseUntil: 0 });
  }
}
export async function tick(repo) {
  await enqueueScheduledJobs(repo);
  const jobs = (await repo.list("jobs")).filter(
    (j) =>
      ["queued", "running"].includes(j.status) &&
      Number(j.leaseUntil || 0) < Date.now(),
  );
  const job =
    jobs.find((j) => j.type === "catalog") ||
    jobs.find((j) => j.type === "benchmarks") ||
    jobs.find((j) => !j.type) ||
    jobs[0];
  if (!job) return { processed: 0 };
  if (!job.type) return processJob(repo, job.id);
  const lease = await repo.leaseJob(job.id, randomUUID());
  if (!lease) return { busy: true };
  try {
    let result;
    if (job.type === "catalog") {
      result = await refreshCatalog(repo);
      // Discovery never infers quality from names. New zero-priced generation models,
      // including anonymous releases, enter a measured screening queue automatically.
      for (const m of (await repo.list("models")).filter(
        (m) =>
          m.service === "generation" &&
          m.costClass === "zero" &&
          m.status === "discovered" &&
          !m.evaluation,
      )) {
        const id =
          "screen-" +
          createHash("sha256")
            .update(m.id + ":" + (m.catalogHash || "manual"))
            .digest("hex")
            .slice(0, 24);
        if (!(await repo.get("jobs", id)))
          await repo.put("jobs", id, {
            id,
            type: "screen",
            modelId: m.id,
            status: "queued",
            leaseUntil: 0,
            createdAt: new Date().toISOString(),
          });
      }
    } else if (job.type === "benchmarks")
      result = await refreshBenchmarks(repo);
    else if (job.type === "screen")
      result = await screenModel(repo, job.modelId, { oneCase: true });
    if (result?.pending) {
      await repo.patch("jobs", job.id, { status: "queued", leaseUntil: 0 });
      return { processed: job.type, pending: true };
    }
    await repo.patch("jobs", job.id, {
      status: "complete",
      leaseUntil: 0,
      finishedAt: Date.now(),
      result,
    });
    return { processed: job.type, result };
  } catch {
    await repo.patch("jobs", job.id, {
      status: "failed",
      leaseUntil: 0,
      finishedAt: Date.now(),
      error: "Background task failed. Previous usable data retained.",
    });
    return { processed: job.type, failed: true };
  }
}
