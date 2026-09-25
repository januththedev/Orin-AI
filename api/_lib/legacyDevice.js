import crypto from 'node:crypto';
import { requireUser, verifySessionPayload, mintSession, httpError } from './auth.js';
import { sdocGet, sdocSet, sdocDelete, squery, TS } from './store.js';
import { rateLimit } from './ratelimit.js';
import { apiHandler } from './http.js';

const CODE_TTL = 8 * 60_000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ALLOWED_SCOPES = new Set(['chat:use', 'account:read', 'tools:use', 'code:use', 'router:manage']);
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const ip = (req) => String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
const userCode = () => `${[...Array(4)].map(() => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}-${[...Array(4)].map(() => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}`;

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const body = req.body || {};
  if (body.action === 'start') {
    if (!(await rateLimit(`device-start:${ip(req)}`, 20, 3_600_000))) throw httpError(429, 'Too many device login attempts.');
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(String(body.client_id || '')) || !/^[A-Za-z0-9_-]{43}$/.test(String(body.code_challenge || '')) || body.code_challenge_method !== 'S256') throw httpError(400, 'Valid client_id and S256 PKCE are required.');
    const scopes = [...new Set((Array.isArray(body.scopes) ? body.scopes : []).map(String).filter((scope) => ALLOWED_SCOPES.has(scope)))];
    if (!scopes.length) throw httpError(400, 'At least one allowed device scope is required.');
    const deviceCode = crypto.randomBytes(32).toString('base64url');
    const code = userCode();
    const id = sha256(deviceCode);
    await sdocSet('device_auth_v2', id, { clientId: String(body.client_id), codeHash: sha256(code), challenge: String(body.code_challenge), scopes, status: 'pending', attempts: 0, createdAt: Date.now(), expiresAt: Date.now() + CODE_TTL });
    return res.status(200).json({ device_code: deviceCode, user_code: code, verification_uri: 'https://orinai.org/#device-auth', expires_in: CODE_TTL / 1000, interval: 5 });
  }
  if (body.action === 'details') {
    const user = await requireUser(req);
    if (!(await rateLimit(`device-details:${user.uid}`, 30, 60_000))) throw httpError(429, 'Slow down.');
    const code = String(body.user_code || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw httpError(404, 'No waiting device found.');
    const docs = await squery('device_auth_v2', [{ field: 'codeHash', value: sha256(code) }, { field: 'status', value: 'pending' }], { limit: 1 });
    const item = docs[0];
    if (!item || Number(item.data().expiresAt) <= Date.now()) throw httpError(404, 'No waiting device found.');
    return res.status(200).json({ client_id: item.data().clientId, scopes: item.data().scopes, requested_at: item.data().createdAt });
  }
  if (body.action === 'approve') {
    const user = await requireUser(req);
    const code = String(body.user_code || '').trim().toUpperCase();
    const docs = await squery('device_auth_v2', [{ field: 'codeHash', value: sha256(code) }, { field: 'status', value: 'pending' }], { limit: 1 });
    const item = docs[0];
    if (!item || Number(item.data().expiresAt) <= Date.now()) throw httpError(404, 'No waiting device found.');
    await sdocSet('device_auth_v2', item.id, { status: 'approved', uid: user.uid, decidedAt: TS() }, true);
    return res.status(200).json({ ok: true, client_id: item.data().clientId, scopes: item.data().scopes });
  }
  if (body.action === 'token') {
    if (!(await rateLimit(`device-token:${ip(req)}`, 12, 60_000))) throw httpError(429, 'Slow down.');
    const deviceCode = String(body.device_code || '');
    const id = sha256(deviceCode);
    const snap = await sdocGet('device_auth_v2', id);
    if (!snap.exists) return res.status(200).json({ status: 'expired' });
    const data = snap.data();
    if (Number(data.expiresAt) <= Date.now()) return res.status(200).json({ status: 'expired' });
    if (data.status === 'pending') return res.status(200).json({ status: 'pending' });
    if (data.status !== 'approved') return res.status(200).json({ status: 'denied' });
    const challenge = crypto.createHash('sha256').update(String(body.code_verifier || '')).digest('base64url');
    if (!challenge || challenge !== data.challenge) throw httpError(401, 'PKCE verification failed.');
    await sdocSet('device_auth_v2', id, { status: 'consumed', consumedAt: TS() }, true);
    const accessJti = `dev_${crypto.randomBytes(12).toString('hex')}`;
    const refreshJti = `ref_${crypto.randomBytes(12).toString('hex')}`;
    const accessToken = mintSession(data.uid, { typ: 'device', jti: accessJti, scopes: data.scopes, expDays: 0.0104 });
    const refreshToken = mintSession(data.uid, { typ: 'device', jti: refreshJti, scopes: data.scopes, expDays: 30 });
    await sdocSet('device_refresh_v2', refreshJti, { uid: data.uid, clientId: data.clientId, scopes: data.scopes, hash: sha256(refreshToken), createdAt: TS() });
    return res.status(200).json({ status: 'approved', access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 900, scope: data.scopes.join(' ') });
  }
  if (body.action === 'refresh') {
    const claims = verifySessionPayload(String(body.refresh_token || ''));
    if (claims.typ !== 'device' || !claims.jti) throw httpError(401, 'Device refresh token required.');
    const id = String(claims.jti);
    const snap = await sdocGet('device_refresh_v2', id);
    if (!snap.exists || snap.data().hash !== sha256(body.refresh_token)) { await sdocDelete('device_refresh_v2', id).catch(() => {}); throw httpError(401, 'Refresh token reuse detected.'); }
    const data = snap.data();
    const nextJti = `ref_${crypto.randomBytes(12).toString('hex')}`;
    const nextToken = mintSession(data.uid, { typ: 'device', jti: nextJti, scopes: data.scopes, expDays: 30 });
    await sdocSet('device_refresh_v2', nextJti, { uid: data.uid, clientId: data.clientId, scopes: data.scopes, hash: sha256(nextToken), createdAt: TS() });
    await sdocDelete('device_refresh_v2', id);
    const accessToken = mintSession(data.uid, { typ: 'device', jti: `dev_${crypto.randomBytes(12).toString('hex')}`, scopes: data.scopes, expDays: 0.0104 });
    return res.status(200).json({ access_token: accessToken, refresh_token: nextToken, token_type: 'Bearer', expires_in: 900, scope: data.scopes.join(' ') });
  }
  throw httpError(400, 'Unknown device action.');
}

export default apiHandler(handler);
