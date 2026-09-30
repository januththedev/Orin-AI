/**
 * Google sign-in, verified in Core.
 *
 * Deliberately not a hosted broker and not a browser SDK. Every Orin product
 * already authenticates through Core, so verifying the Google ID token here and
 * minting an Orin session is what makes one Google button work everywhere
 * without adding a new party that holds user identity.
 *
 * This is a pure module over injectable dependencies, so the rules below are
 * testable without a network or a Google client.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

export const GOOGLE_ISSUERS = Object.freeze([
  'https://accounts.google.com',
  'accounts.google.com',
]);

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Minimal scopes. Drive/Gmail are a separate, separately-consented thing. */
export const SCOPES = ['openid', 'email', 'profile'];

/** Return targets we will hand a signed-in browser back to. */
const ALLOWED_RETURN_HOSTS = new Set([
  'orinai.org', 'www.orinai.org',
  'chat.orinai.org', 'code.orinai.org', 'agent.orinai.org',
  'tools.orinai.org', 'console.orinai.org', 'automate.orinai.org', 'mcp.orinai.org',
  'router.orinai.org',
]);

/**
 * Resolve a return target, or null.
 *
 * Anything not on the list is refused rather than coerced, because this is the
 * value the browser is redirected to straight after authenticating — an open
 * redirect here is a credential-phishing primitive.
 */
export function safeReturn(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!ALLOWED_RETURN_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password) return null;
  url.hash = '';
  url.search = '';
  return url.toString();
}

export function buildAuthUrl({
  clientId,
  redirectUri,
  state,
  nonce,
  codeChallenge,
}) {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'online',
    prompt: 'select_account',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

/** Exchange an authorization code. Throws with a safe message on failure. */
export async function exchangeCode({ code, codeVerifier, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id_token) {
    throw new Error(data.error_description || 'Google sign-in could not be completed.');
  }
  return data;
}

/**
 * Verify a Google ID token and return the claims we rely on.
 *
 * The checks that matter, in order of how often they are forgotten:
 *   1. signature, against Google's published JWKS
 *   2. issuer is one of Google's, not merely a string that claims to be
 *   3. audience is *our* client id
 *   4. nonce is the one we issued
 *   5. not expired (jwtVerify does this)
 *   6. email is present and marked verified
 *
 * An unverified Google email must never be treated as an identity. Google lets
 * an account hold an address it has not proven; trusting that would let anyone
 * claim a Google account with someone else's address and take their Orin
 * account with it.
 */
export async function verifyIdToken({
  idToken,
  clientId,
  nonce,
  jwks,
  fetchImpl = fetch,
}) {
  const keySet = jwks ?? createRemoteJWKSet(new URL(JWKS_URL), { timeoutDuration: 5000 });
  const { payload } = await jwtVerify(idToken, keySet, {
    issuer: [...GOOGLE_ISSUERS],
    audience: clientId,
    nonce,
  });

  if (!GOOGLE_ISSUERS.includes(String(payload.iss))) {
    throw new Error('The Google token came from an unexpected issuer.');
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email) throw new Error('Google did not return an email address.');
  if (payload.email_verified !== true) {
    throw new Error('That Google account has an unverified email address, so it cannot be used to sign in.');
  }
  return {
    subject: String(payload.sub || ''),
    email,
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' ? payload.picture : '',
  };
}

/** Deterministic local-account id, so the same Google user maps to one account. */
export function uidForGoogle(subject) {
  return `gg_${subject.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;
}
