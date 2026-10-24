import {
  studentCatalog,
  importStudentBatch,
} from "../api/_lib/workspace/student-bundle.js";
import { Repository } from "../api/_lib/workspace/repository.js";
const apply = process.argv.includes("--apply");
try {
  const catalog = await studentCatalog();
  if (!apply)
    console.log(
      JSON.stringify({
        dryRun: true,
        academicPacks: catalog.academicPacks,
        practicalPacks: catalog.practicalPacks,
        records: catalog.totalRecords,
        next: "Run with --apply to import draft documents. No indexing or publication occurs automatically.",
      }),
    );
  else {
    if (!process.env.DATABASE_URL)
      throw new Error(
        "Set DATABASE_URL for the database to receive draft documents.",
      );
    const repository = new Repository();
    let next = 0,
      created = 0,
      updated = 0,
      unchanged = 0;
    while (next !== null) {
      const batch = await importStudentBatch(repository, { offset: next });
      for (const item of batch.results) {
        if (item.result === "created") created++;
        else if (item.result === "updated") updated++;
        else unchanged++;
      }
      next = batch.next;
      console.log(
        JSON.stringify({
          processed: created + updated + unchanged,
          total: batch.total,
          created,
          updated,
          unchanged,
        }),
      );
    }
    console.log(
      JSON.stringify({
        ok: true,
        created,
        updated,
        unchanged,
        publication: "drafts",
        providerCalls: 0,
      }),
    );
  }
} catch (e) {
  let message = String(e.message);
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const value = process.env[key];
    if (value) {
      message = message.replaceAll(value, "[redacted]");
      try {
        message = message.replaceAll(new URL(value).password, "[redacted]");
      } catch {}
    }
  }
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
}
