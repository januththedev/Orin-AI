import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("Set DATABASE_URL to the Neon branch you intend to migrate.");
const sql = neon(databaseUrl);
const schema = (await Promise.all([
  new URL("../api/_lib/schema.sql", import.meta.url),
  new URL("../api/_lib/workspace/schema.sql", import.meta.url),
].map(path => readFile(path, "utf8")))).join("\n");
// This migration contains no function bodies: semicolon splitting is intentional.
await sql.transaction(
  schema
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => sql.query(s)),
);
console.log("Orin application tables, workspace tables, and pgvector are ready.");
