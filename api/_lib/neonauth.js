/**
 * Neon Auth session-token verification (Ed25519/JWKS, no new deps).
 *
 * Neon Auth signs access tokens with EdDSA (Ed25519) — NOT RS256 — so this
 * verifier is purpose-built: fetch the project's JWKS, match kid, verify
 * with a null algorithm. Default JWKS is this project's Neon Auth endpoint;
 * override with NEON_AUTH_JWKS_URL.
 */
import crypto from 'crypto';

const JWKS_URL =
  process.env.NEON_AUTH_JWKS_URL ||
  'https://ep-dawn-butterfly-avsgxtbo.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json';
const JWKS_TTL_MS = 10 * 60_000;

let jwksCache = { at: 0, keys: [] };

function b64urlDecode(seg) {
  return Buffer.from(String(seg).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function getJwks() {
  if (Date.now() - jwksCache.at < JWKS_TTL_MS && jwksCache.keys.length) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw Object.assign(new Error(`Auth JWKS HTTP ${res.status}`), { code: 502 });
  const json = await res.json().catch(() => ({}));
  const keys = Array.isArray(json.keys) ? json.keys : [];
  if (!keys.length) throw Object.assign(new Error('Empty Auth JWKS'), { code: 502 });
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/**
 * Verify a Neon Auth access token. Returns the payload ({ sub, … }).
 * Throws { code } httpErrors on any failure. Never logs the token.
 */
export async function verifyNeonToken(token) {
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
  if (!header.kid) throw Object.assign(new Error('Token has no key id'), { code: 401 });
  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw Object.assign(new Error('Unknown signing key'), { code: 401 });
  let valid = false;
  try {
    // Ed25519 (OKP) and RSA both import via JWK; EdDSA verifies with a null
    // algorithm, RS256 with RSA-SHA256.
    const pubkey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const alg = header.alg === 'RS256' ? 'RSA-SHA256' : null;
    valid = crypto.verify(alg, Buffer.from(`${hB64}.${pB64}`), pubkey, b64urlDecode(sigB64));
  } catch {
    valid = false;
  }
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
