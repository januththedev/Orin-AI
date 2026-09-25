import crypto from 'node:crypto';
import { sdocGet, sdocSet, sdocUpdate, squery, TS } from './store.js';

export const BFF_COOKIE = 'orin_session';
const DAY_MS = 86_400_000;
function handleFromReq(req) { return cookies(req)[BFF_COOKIE] || ''; }
function hashSecret() {
  const value = process.env.ORIN_SESSION_HASH_KEY || process.env.TOKEN_ENCRYPTION_KEY || '';
  if (value.length < 32) throw Object.assign(new Error('ORIN_SESSION_HASH_KEY is required'), { code: 500 });
  return value;
}
function hashHandle(handle) { return crypto.createHmac('sha256', hashSecret()).update(handle).digest('hex'); }
function equal(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function cookies(req) { const out = {}; for (const part of String(req.headers?.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } return out; }
function setCookie(res, value, maxAge = 30 * 24 * 3600, extra = []) { const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : ''; res.setHeader('Set-Cookie', [`${BFF_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`, ...extra]); }
export async function createBffSession(res, uid, product = 'orin-chat', email = '') {
  const handle = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const id = hashHandle(handle);
  await sdocSet('bff_sessions', id, { uid, product, email, handleHash: hashHandle(handle), previousHash: null, previousValidUntil: 0, generation: 1, state: 'active', createdAt: now, lastUsedAt: now, absoluteExpiresAt: now + 30 * DAY_MS, idleExpiresAt: now + 7 * DAY_MS }, true);
  const csrf = crypto.randomBytes(24).toString('base64url');
  setCookie(res, handle, 30 * 24 * 3600, [`orin_csrf=${csrf}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax${process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : ''}`]);
  await sdocSet('bff_sessions', id, { csrfHash: hashHandle(csrf) }, true);
  return { id, uid, product, expiresAt: now + 30 * DAY_MS };
}
export async function resolveBffSession(req) {
  const handle = handleFromReq(req);
  if (!handle || !/^[A-Za-z0-9_-]{40,64}$/.test(handle)) throw Object.assign(new Error('Unauthorized'), { code: 401 });
  const hash = hashHandle(handle);
  const docs = await sdocGet('bff_sessions', hash).catch(() => ({ exists: false }));
  if (!docs.exists) throw Object.assign(new Error('Unauthorized'), { code: 401 });
  const session = docs.data();
  const now = Date.now();
  if (session.state !== 'active' || Number(session.absoluteExpiresAt) <= now || Number(session.idleExpiresAt) <= now) throw Object.assign(new Error('Session expired'), { code: 401 });
  const current = equal(session.handleHash, hash);
  const previous = session.previousHash && Number(session.previousValidUntil) > now && equal(session.previousHash, hash);
  if (!current && !previous) { await sdocUpdate('bff_sessions', hash, { state: 'revoked', revokedAt: TS() }).catch(() => {}); throw Object.assign(new Error('Session reuse detected'), { code: 401 }); }
  const user = await sdocGet('users', String(session.uid));
  if (!user.exists) throw Object.assign(new Error('Unauthorized'), { code: 401 });
  await sdocUpdate('bff_sessions', hash, { lastUsedAt: now, idleExpiresAt: Math.min(Number(session.absoluteExpiresAt), now + 7 * DAY_MS) }).catch(() => {});
  return { id: hash, uid: String(session.uid), email: String(session.email || user.data()?.email || ''), product: String(session.product || 'orin-chat'), generation: Number(session.generation || 1), typ: 'session' };
}
export async function rotateBffSession(req, res) {
  const session = await resolveBffSession(req);
  const now = Date.now();
  const next = crypto.randomBytes(32).toString('base64url');
  await sdocUpdate('bff_sessions', session.id, { previousHash: hashHandle(handleFromReq(req)), previousValidUntil: now + 60_000, handleHash: hashHandle(next), generation: session.generation + 1, lastUsedAt: now, idleExpiresAt: Math.min(Number(session.absoluteExpiresAt || now + 30 * DAY_MS), now + 7 * DAY_MS) }, true);
  setCookie(res, next);
  return { ...session, generation: session.generation + 1 };
}
export async function revokeBffSession(req, res, all = false) {
  const session = await resolveBffSession(req);
  const ids = all ? (await squery('bff_sessions', [{ field: 'uid', value: session.uid }, { field: 'state', value: 'active' }], { limit: 200 })).map((item) => item.id) : [session.id];
  for (const id of ids) await sdocUpdate('bff_sessions', id, { state: 'revoked', revokedAt: TS() }, true);
  setCookie(res, '', 0);
  return { revoked: true, all, count: ids.length };
}
export function requireCsrf(req) {
  const expected = String(req.headers?.['x-orin-csrf'] || '');
  const cookie = cookies(req).orin_csrf || '';
  if (!expected || !cookie || !equal(expected, cookie)) throw Object.assign(new Error('Invalid CSRF token'), { code: 403 });
}
