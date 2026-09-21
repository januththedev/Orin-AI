/**
 * Postgres-backed fixed-window rate limiting (Neon).
 * Survives serverless cold starts (an in-memory Map does not).
 * Usage: if (!(await rateLimit('login:ip:'+ip, 30, 3600_000))) throw httpError(429, ...);
 * Returns true when the action is allowed. Single atomic statement.
 */
import { srateLimit } from './store.js';

export async function rateLimit(key, limit, windowMs) {
  const docId = key.replace(/[/\\#?*[\]]/g, '_').slice(0, 400);
  try {
    return await srateLimit(docId, limit, windowMs);
  } catch (e) {
    // Fail open on rate-limit infrastructure errors, but log loudly.
    console.error('[ratelimit] failed for', key, e.message);
    return true;
  }
}
