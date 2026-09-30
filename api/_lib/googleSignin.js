/**
 * Sign in with a Google account.
 *
 * Reached as `/api/auth/google-signin`, dispatched from `api/auth/[...path].js`
 * rather than deployed as its own function: at 13 functions this project was
 * one over Vercel's Hobby limit of 12, which fails the deploy *after* a
 * successful build.
 *
 * GET  → { authorizationUrl }   the caller sends the browser to Google
 * POST → { code, state, nonce, codeVerifier }
 *      verifies the ID token, finds or creates the Orin account, sets the
 *      session cookie, and returns where to send the browser next.
 *
 * This is separate from /api/auth/google, which stores Google *Drive/Gmail*
 * module tokens for an already-authenticated user. Mixing identity with
 * delegated module access is how a "connect your Drive" button quietly becomes
 * a sign-in button.
 */

import { createBffSession } from './bff.js';
import { httpError } from './auth.js';
import { sdocGet, sdocSet, squery, TS } from './store.js';
import {
  buildAuthUrl,
  exchangeCode,
  safeReturn,
  uidForGoogle,
  verifyIdToken,
} from './googleIdentity.js';

const DEFAULT_RETURN = 'https://orinai.org/';
/** Short-lived: this is an in-flight hand-off, not a session. */
const HANDSHAKE_TTL_MS = 10 * 60 * 1000;

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw httpError(503, 'Google sign-in is not configured.');
  }
  const origin = String(process.env.ORIN_ORIGIN || 'https://orinai.org').replace(/\/+$/, '');
  return { clientId, clientSecret, redirectUri: `${origin}/api/auth/google-signin` };
}

function handshakeKey(state) {
  return `google_signin/${state}`;
}

function randomToken(bytes = 24) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    throw httpError(405, 'GET or POST only.');
  }
  const { clientId, clientSecret, redirectUri } = config();

  if (req.method === 'GET') {
    const returnTo = safeReturn(new URL(req.url || '/', 'http://x').searchParams.get('return_to')) || DEFAULT_RETURN;
    const state = randomToken();
    const nonce = randomToken();
    // PKCE, so an intercepted code cannot be redeemed without the verifier that
    // only ever existed in this server's store.
    const codeVerifier = randomToken(32);
    const codeChallenge = await sha256Base64Url(codeVerifier);

    await sdocSet(handshakeKey(state), { nonce, codeVerifier, returnTo, createdAt: Date.now() }, true).catch(() => {});

    return res.status(200).json({
      authorizationUrl: buildAuthUrl({ clientId, redirectUri, state, nonce, codeChallenge }),
      state,
    });
  }

  const body = req.body || {};
  const state = String(body.state || '');
  const code = String(body.code || '');
  if (!state || !code) throw httpError(400, 'state and code are required.');

  const stored = await sdocGet(handshakeKey(state)).catch(() => ({ exists: false }));
  // One-time: a state can be redeemed exactly once, and only while fresh.
  await sdocSet(handshakeKey(state), {}, false).catch(() => {});
  if (!stored.exists) throw httpError(400, 'That sign-in attempt has expired. Start again.');
  const pending = stored.data() || {};
  if (Date.now() - Number(pending.createdAt || 0) > HANDSHAKE_TTL_MS) {
    throw httpError(400, 'That sign-in attempt has expired. Start again.');
  }

  const tokens = await exchangeCode({
    code,
    codeVerifier: String(pending.codeVerifier || ''),
    clientId,
    clientSecret,
    redirectUri,
  }).catch((error) => {
    throw httpError(401, error?.message || 'Google sign-in could not be completed.');
  });

  const identity = await verifyIdToken({
    idToken: tokens.id_token,
    clientId,
    nonce: String(pending.nonce || ''),
  }).catch((error) => {
    throw httpError(401, error?.message || 'That Google sign-in could not be verified.');
  });

  const uid = await resolveUid(identity);
  await sdocSet(`users/${uid}`, {
    id: uid,
    email: identity.email,
    name: identity.name || identity.email.split('@')[0],
    picture: identity.picture,
    google_sub: identity.subject,
    authProvider: 'google',
    createdAt: TS(),
    lastLoginAt: TS(),
  }, true);

  const session = await createBffSession(res, uid, 'orin-google', identity.email);
  return res.status(200).json({
    ok: true,
    user: { id: uid, email: identity.email, name: identity.name },
    returnTo: safeReturn(pending.returnTo) || DEFAULT_RETURN,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
}

/** Find or create the Orin account for a verified Google identity. */
async function resolveUid(identity) {
  const googleUid = uidForGoogle(identity.subject);
  const existingGoogle = await sdocGet('users', googleUid).catch(() => ({ exists: false }));
  if (existingGoogle.exists) return googleUid;

  const matches = await squery('users', 'email', identity.email).catch(() => []);
  const match = Array.isArray(matches) ? matches[0] : null;
  if (match && match.id) return String(match.id);

  return googleUid;
}