/**
 * Google OAuth backend — token exchange + refresh + status
 * POST /api/auth/google  body: { action: 'exchange'|'refresh'|'getToken'|'disable'|'enable', code?, verifier?, module?, redirectUri? }
 * GET  /api/auth/google  → { connected: bool, modules: { gmail: bool, ... } }
 *
 * Tokens stored AES-256-GCM encrypted in Firestore: users/{uid}/google_tokens/{module}
 * Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY (32+ chars)
 */
import { requireUser } from '../_lib/firebase.js';
import { sdocGet, sdocSet, sdocUpdate, slist, TS } from '../_lib/store.js';
import { apiHandler } from '../_lib/http.js';
import { encryptToken, decryptToken } from '../_lib/crypto.js';

export const config = { maxDuration: 30 };

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || process.env.VITE_GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

async function handler(req, res) {
  const uid = await requireUser(req);
  const tokensCol = `users/${uid}/google_tokens`;

  // ── GET: connection status ───────────────────────────────────────────────
  if (req.method === 'GET') {
    const docs = await slist(tokensCol);
    const modules = {};
    docs.forEach(d => { modules[d.id] = d.data().enabled === true; });
    return res.status(200).json({ connected: Object.values(modules).some(Boolean), modules });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET/POST only' });

  const { action, code, verifier, module, redirectUri } = req.body || {};
  // `module` becomes a Firestore doc ID — constrain it to safe characters.
  const safeModule = typeof module === 'string' ? module.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : '';

  // ── exchange ─────────────────────────────────────────────────────────────
  if (action === 'exchange') {
    if (!code || !verifier || !safeModule) return res.status(400).json({ error: 'code, verifier, module required' });
    if (!CLIENT_SECRET) return res.status(500).json({ error: 'GOOGLE_CLIENT_SECRET not configured' });

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
    });
    const data = await r.json();
    if (!data.access_token) return res.status(400).json({ error: data.error_description || 'Token exchange failed' });

    await sdocSet(tokensCol, safeModule, {
      accessToken:   encryptToken(data.access_token),
      refreshToken:  data.refresh_token ? encryptToken(data.refresh_token) : null,
      expiresAt:     Date.now() + (data.expires_in || 3600) * 1000,
      grantedScopes: (data.scope || '').split(' '),
      connectedAt:   TS(),
      enabled:       true,
    });
    return res.status(200).json({ ok: true, module: safeModule });
  }

  // ── getToken (auto-refreshes if expired) ─────────────────────────────────
  if (action === 'getToken') {
    if (!safeModule) return res.status(400).json({ error: 'module required' });
    const snap = await sdocGet(tokensCol, safeModule);
    if (!snap.exists || !snap.data().enabled) return res.status(404).json({ error: 'Not connected' });
    const d = snap.data();

    if (d.expiresAt < Date.now() + 60000 && d.refreshToken && CLIENT_SECRET) {
      const rt = decryptToken(d.refreshToken);
      if (rt) {
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' }),
        });
        const rd = await r.json();
        if (rd.access_token) {
          await sdocUpdate(tokensCol, safeModule, { accessToken: encryptToken(rd.access_token), expiresAt: Date.now() + (rd.expires_in || 3600) * 1000 });
          return res.status(200).json({ accessToken: rd.access_token });
        }
      }
    }
    const at = decryptToken(d.accessToken);
    if (!at) return res.status(400).json({ error: 'Token decrypt failed — was TOKEN_ENCRYPTION_KEY rotated?' });
    return res.status(200).json({ accessToken: at });
  }

  // ── refresh ───────────────────────────────────────────────────────────────
  if (action === 'refresh') {
    if (!safeModule) return res.status(400).json({ error: 'module required' });
    if (!CLIENT_SECRET) return res.status(500).json({ error: 'GOOGLE_CLIENT_SECRET not configured' });
    const snap = await sdocGet(tokensCol, safeModule);
    if (!snap.exists || !snap.data().refreshToken) return res.status(400).json({ error: 'No refresh token' });
    const rt = decryptToken(snap.data().refreshToken);
    if (!rt) return res.status(400).json({ error: 'Decrypt failed — was TOKEN_ENCRYPTION_KEY rotated?' });
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' }),
    });
    const data = await r.json();
    if (!data.access_token) return res.status(400).json({ error: 'Refresh failed' });
    await sdocUpdate(tokensCol, safeModule, { accessToken: encryptToken(data.access_token), expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
    return res.status(200).json({ ok: true });
  }

  // ── disable / enable ─────────────────────────────────────────────────────
  if (action === 'disable') {
    if (!safeModule) return res.status(400).json({ error: 'module required' });
    await sdocUpdate(tokensCol, safeModule, { enabled: false });
    return res.status(200).json({ ok: true });
  }

  if (action === 'enable') {
    if (!safeModule) return res.status(400).json({ error: 'module required' });
    await sdocUpdate(tokensCol, safeModule, { enabled: true });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

export default apiHandler(handler);
