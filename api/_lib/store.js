/**
 * Postgres doc-store (Neon) mirroring the Firestore shapes the routes were
 * written against — get/set/update/delete/add plus == queries — so the
 * migration stays mechanical and reviewable. Timestamps are epoch millis
 * (numbers), NOT Firestore Timestamp objects: call sites compare with
 * Number(d.expiresAt) instead of d.expiresAt?.toMillis?.().
 *
 * Nested subcollections are encoded in the collection string:
 * `users/<uid>/files`. Atomic paths (rate limits, device approve) use single
 * conditional statements instead of transactions.
 *
 * Env: DATABASE_URL (Neon pooled connection string). Firebase Admin stays
 * for Auth (ID tokens / custom tokens) — only DATA moved to Neon.
 */
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

let client = null;

/** Low-level sql tag (one call per query — Neon serverless is HTTP). */
export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
    if (!url) throw Object.assign(new Error('DATABASE_URL not configured'), { code: 500 });
    client = neon(url);
  }
  return client;
}

/** Epoch millis — replaces Firestore serverTimestamp in stored docs. */
export const TS = () => Date.now();

function snap(row) {
  return {
    exists: !!row,
    id: row?.id,
    data: () => (row ? row.data : undefined),
  };
}

export async function sdocGet(collection, id) {
  const rows = await sql()`SELECT id, data FROM orin_docs WHERE collection=${collection} AND id=${String(id)}`;
  return snap(rows[0]);
}

export async function sdocSet(collection, id, data, merge = false) {
  const payload = JSON.stringify(data ?? {});
  if (merge) {
    await sql()`INSERT INTO orin_docs(collection, id, data) VALUES(${collection}, ${String(id)}, ${payload}::jsonb)
      ON CONFLICT(collection, id) DO UPDATE SET data = orin_docs.data || EXCLUDED.data, updated_at = now()`;
  } else {
    await sql()`INSERT INTO orin_docs(collection, id, data) VALUES(${collection}, ${String(id)}, ${payload}::jsonb)
      ON CONFLICT(collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  }
}

export async function sdocUpdate(collection, id, data) {
  return sdocSet(collection, id, data, true);
}

export async function sdocDelete(collection, id) {
  await sql()`DELETE FROM orin_docs WHERE collection=${collection} AND id=${String(id)}`;
}

export async function sadd(collection, data) {
  const id = crypto.randomBytes(16).toString('hex');
  await sdocSet(collection, id, data || {});
  return { id };
}

/**
 * == filters only: [{ field, value }] (+ optional limit). All current
 * queries are top-level equality matches. Returns [{ id, data() }].
 */
export async function squery(collection, filters = [], { limit = 100 } = {}) {
  const db = sql();
  let text = `SELECT id, data FROM orin_docs WHERE collection = $1`;
  const values = [collection];
  for (const f of filters) {
    values.push(String(f.value));
    text += ` AND data->>'${String(f.field).replace(/[^a-zA-Z0-9_]/g, '')}' = $${values.length}`;
  }
  text += ` ORDER BY updated_at DESC LIMIT ${Math.min(Math.max(limit | 0, 1), 500)}`;
  const rows = await db.query(text, values);
  return (rows.rows || rows).map((row) => ({ id: row.id, data: () => row.data }));
}

/** List every doc in a collection (e.g. per-module token rows). */
export async function slist(collection, { limit = 100 } = {}) {
  return squery(collection, [], { limit });
}

/**
 * Atomic integer increment at a nested path (usage counters). Creates the
 * doc/rows as needed — mirrors FieldValue.increment + merge-set.
 */
export async function sincr(collection, id, path) {
  const pointer = `{${path.map((p) => String(p).replace(/[^a-zA-Z0-9_]/g, '')).join(',')}}`;
  const rows = await sql()`INSERT INTO orin_docs(collection, id, data)
    VALUES(${collection}, ${String(id)}, '{}'::jsonb)
    ON CONFLICT(collection, id) DO UPDATE SET
      data = jsonb_set(orin_docs.data, ${pointer}::text[], to_jsonb(COALESCE((orin_docs.data#>>${pointer}::text[])::int, 0) + 1), true),
      updated_at = now()
    RETURNING (data#>>${pointer}::text[])::int AS count`;
  const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
  return row ? Number(row.count) : 0;
}

/**
 * Atomic fixed-window rate limit. Returns true when allowed. Single
 * statement — no transaction needed.
 */
export async function srateLimit(docId, limit, windowMs) {
  const now = Date.now();
  const rows = await sql()`INSERT INTO orin_docs(collection, id, data)
    VALUES('__ratelimit', ${String(docId).slice(0, 400)}, ${JSON.stringify({ count: 1, windowStart: now })}::jsonb)
    ON CONFLICT(collection, id) DO UPDATE SET
      data = CASE WHEN (${now} - COALESCE((orin_docs.data->>'windowStart')::bigint, 0)) >= ${windowMs}
        THEN ${JSON.stringify({ count: 1, windowStart: now })}::jsonb
        ELSE jsonb_set(orin_docs.data, '{count}', to_jsonb(COALESCE((orin_docs.data->>'count')::int, 0) + 1))
        END,
      updated_at = now()
    RETURNING (data->>'count')::int AS count`;
  const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
  return row ? Number(row.count) <= limit : true;
}
