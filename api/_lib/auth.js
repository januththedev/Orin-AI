/**
 * Orin Auth — Neon-first, zero Firebase/Clerk.
 *
 * Two accepted Bearer credentials:
 *   1. Orin session tokens (HS256 JWT, signed with TOKEN_ENCRYPTION_KEY):
 *      minted by /api/auth/password (register/login), /api/auth/google
 *      (GIS sign-in), /api/auth/neon (Neon Auth exchange) and /api/auth/device
 *      (desktop flow). 30-day expiry, revocable via users/{uid}.tokenVersion.
 *   2. Neon Auth access tokens (EdDSA/JWKS via ./neonauth.js): verified by
 *      signature only; uid is derived deterministically (`n_<sub>`).
 *      Provisioning happens in the exchange endpoints, never here.
 *
 * requireUser → { uid, email } (same shape old callers used from Firebase
 * decoded tokens). verifyUser → uid | null. httpError unchanged.
 */
import crypto from 'crypto';
import { verifyNeonToken } from './neonauth.js';
import { sdocGet } from './store.js';

export function httpError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function bearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(seg) {
  return Buffer.from(String(seg).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sessionSecret() {
  const s = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (s.length < 32) throw httpError(500, 'TOKEN_ENCRYPTION_KEY not configured (min 32 chars)');
  return s;
}

/** Keep uids safe for URLs/collection ids. */
export function sanitizeUid(v) {
  return String(v || '').replace(/[^a-zA-Z0-9_@.+-]/g, '_').slice(0, 120);
}

/**
 * Mint an Orin session token. tv = users/{uid}.tokenVersion at mint time;
 * bumping tokenVersion revokes all previously minted sessions.
 */
export function mintSession(uid, { email = '', tv = 0 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    iss: 'orin', uid: String(uid), email: String(email || ''),
    tv: Number(tv) || 0, iat: now, exp: now + 30 * 24 * 3600,
  }));
  const sig = b64url(crypto.createHmac('sha256', sessionSecret()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifySessionSignature(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw httpError(401, 'Invalid or expired token');
  const [h, p, s] = parts;
  let header;
  try {
    header = JSON.parse(b64urlDecode(h).toString('utf8'));
  } catch {
    throw httpError(401, 'Invalid or expired token');
  }
  if (header.alg !== 'HS256' || header.iss !== undefined) {
    // iss lives in payload for our tokens; header must be plain HS256.
    if (header.alg !== 'HS256') throw httpError(401, 'Invalid or expired token');
  }
  const expect = b64url(crypto.createHmac('sha256', sessionSecret()).update(`${h}.${p}`).digest());
  const a = Buffer.from(expect);
  const b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw httpError(401, 'Invalid or expired token');
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch {
    throw httpError(401, 'Invalid or expired token');
  }
  if (payload.iss !== 'orin' || !payload.uid) throw httpError(401, 'Invalid or expired token');
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000) - 30) {
    throw httpError(401, 'Session expired — sign in again');
  }
  return payload;
}

/** Full session check incl. revocation (tokenVersion). Throws 401. */
async function checkSession(token) {
  const payload = verifySessionSignature(token);
  const uid = String(payload.uid);
  let tv = 0;
  try {
    const snap = await sdocGet('users', uid);
    if (snap.exists) tv = Number(snap.data()?.tokenVersion) || 0;
  } catch {
    // DB hiccup: fail closed only when we can prove revocation; otherwise
    // accept the signature (endpoints re-check on write paths).
    return { uid, email: payload.email || '' };
  }
  if ((Number(payload.tv) || 0) !== tv) throw httpError(401, 'Session revoked — sign in again');
  return { uid, email: payload.email || '' };
}

/**
 * Resolve any accepted Bearer token to { uid, email }.
 * Neon Auth JWTs are accepted by signature (provisioned at exchange time).
 */
export async function resolveAuth(token) {
  if (!token) throw httpError(401, 'Unauthorized');
  // Route by header: our HS256 sessions verify locally (tampered ones fail
  // HERE — never waste a JWKS fetch); everything else tries Neon Auth.
  try {
    const segs = String(token).split('.');
    if (segs.length === 3) {
      const header = JSON.parse(b64urlDecode(segs[0]).toString('utf8'));
      if (header && header.alg === 'HS256') return await checkSession(token);
      const probe = JSON.parse(b64urlDecode(segs[1]).toString('utf8'));
      if (probe && probe.iss === 'orin') return await checkSession(token);
    }
  } catch (e) {
    // A structurally-valid HS256 header that fails signature errors inside
    // checkSession — but a JSON parse failure here means "not ours".
    if (e && e.code === 401) throw e;
  }
  const payload = await verifyNeonToken(token);
  const email = payload.email || payload.primary_email || '';
  return { uid: 'n_' + sanitizeUid(payload.sub), email: String(email || '') };
}

/** Returns uid or null — never throws. For endpoints where auth is optional. */
export async function verifyUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    return (await resolveAuth(token)).uid;
  } catch {
    return null;
  }
}

/** Returns { uid, email } or throws { code: 401 }. For endpoints where auth is required. */
export async function requireUser(req) {
  const token = bearerToken(req);
  if (!token) throw httpError(401, 'Unauthorized');
  try {
    return await resolveAuth(token);
  } catch (e) {
    if (e && (e.code === 401 || e.code === 502)) throw httpError(401, e.message || 'Invalid or expired token');
    throw e;
  }
}
