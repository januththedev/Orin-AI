import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL to the Neon branch you intend to migrate.");
const sql = neon(process.env.DATABASE_URL);
const schema = await readFile(
  new URL("../api/_lib/workspace/schema.sql", import.meta.url),
  "utf8",
);
// This migration contains no function bodies: semicolon splitting is intentional.
await sql.transaction(
  schema
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => sql.query(s)),
);
console.log("Workspace tables and pgvector are ready.");
