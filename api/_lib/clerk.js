/**
 * Clerk session-token verification + Backend API user fetch. No new deps:
 * global fetch plus node:crypto against Clerk's JWKS.
 *
 * Env: CLERK_SECRET_KEY (sk_live_…), optional CLERK_JWKS_URL
 * (default https://api.clerk.com/v1/jwks).
 */
import crypto from 'crypto';

const JWKS_URL = process.env.CLERK_JWKS_URL || 'https://api.clerk.com/v1/jwks';
const JWKS_TTL_MS = 10 * 60_000;

let jwksCache = { at: 0, keys: [] };

function b64urlDecode(seg) {
  return Buffer.from(String(seg).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function getJwks() {
  if (Date.now() - jwksCache.at < JWKS_TTL_MS && jwksCache.keys.length) return jwksCache.keys;
  const secret = process.env.CLERK_SECRET_KEY || '';
  if (!secret) throw Object.assign(new Error('CLERK_SECRET_KEY not configured'), { code: 500 });
  const res = await fetch(JWKS_URL, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) throw Object.assign(new Error(`Clerk JWKS HTTP ${res.status}`), { code: 502 });
  const json = await res.json().catch(() => ({}));
  const keys = Array.isArray(json.keys) ? json.keys : [];
  if (!keys.length) throw Object.assign(new Error('Empty Clerk JWKS'), { code: 502 });
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/**
 * Verify a Clerk session JWT. Returns the payload ({ sub, sid, … }).
 * Throws { code } httpErrors on any failure. Never logs the token.
 */
export async function verifyClerkToken(token) {
  if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
    throw Object.assign(new Error('Missing or malformed session token'), { code: 401 });
  }
  const [hB64, pB64, sigB64] = token.split('.');
  let header;
  try {
    header = JSON.parse(b64urlDecode(hB64).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Bad token header'), { code: 401 });
  }
  if (header.alg !== 'RS256' || !header.kid) {
    throw Object.assign(new Error('Unexpected token algorithm'), { code: 401 });
  }
  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid && (!k.use || k.use === 'sig'));
  if (!jwk) throw Object.assign(new Error('Unknown signing key'), { code: 401 });
  const pubkey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${hB64}.${pB64}`),
    pubkey,
    b64urlDecode(sigB64),
  );
  if (!valid) throw Object.assign(new Error('Bad token signature'), { code: 401 });
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(pB64).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Bad token payload'), { code: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now - 30) {
    throw Object.assign(new Error('Expired session — sign in again'), { code: 401 });
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) {
    throw Object.assign(new Error('Session not yet valid'), { code: 401 });
  }
  if (!payload.sub) throw Object.assign(new Error('Token has no subject'), { code: 401 });
  return payload;
}

/** Authoritative profile from the Clerk Backend API (needs the secret). */
export async function clerkUser(clerkId) {
  const secret = process.env.CLERK_SECRET_KEY || '';
  if (!secret) throw Object.assign(new Error('CLERK_SECRET_KEY not configured'), { code: 500 });
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (res.status === 404) throw Object.assign(new Error('Clerk user not found'), { code: 401 });
  if (!res.ok) throw Object.assign(new Error(`Clerk user lookup HTTP ${res.status}`), { code: 502 });
  const u = await res.json().catch(() => ({}));
  const primaryEmail = (u.email_addresses || []).find((e) => e.id === u.primary_email_address_id)
    || (u.email_addresses || [])[0] || {};
  const primaryPhone = (u.phone_numbers || []).find((p) => p.id === u.primary_phone_number_id)
    || (u.phone_numbers || [])[0] || {};
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
    || primaryEmail.email_address?.split('@')[0] || 'Orin user';
  return {
    id: u.id,
    name,
    email: primaryEmail.email_address || '',
    phone: primaryPhone.phone_number || '',
    image: u.image_url || '',
  };
}
