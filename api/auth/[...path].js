import passwordHandler from '../_lib/legacyPassword.js';
import neonHandler from '../_lib/legacyNeon.js';
import deviceHandler from '../_lib/legacyDevice.js';
import { verifySessionPayload, requireUser, httpError } from '../_lib/auth.js';
import { createBffSession, resolveBffSession, rotateBffSession, revokeBffSession, requireCsrf } from '../_lib/bff.js';
import { handleMcpManagement, verifyMcpAuthorization } from '../_lib/mcpAuth.js';
import { apiHandler } from '../_lib/http.js';

export const config = { maxDuration: 30 };

function captureResponse() {
  let status = 200; let body = null;
  return {
    state: { get status() { return status; }, get body() { return body; } },
    res: {
      setHeader() {},
      status(value) { status = value; return this; },
      json(value) { body = value; return this; },
      end() { return this; },
    },
  };
}
async function invoke(handler, req) {
  const capture = captureResponse();
  await handler(req, capture.res);
  return capture.state;
}
async function establishBff(req, res, payload) {
  if (!payload?.sessionToken) return payload;
  const claims = verifySessionPayload(payload.sessionToken);
  await createBffSession(res, String(claims.uid), 'orin-chat', String(claims.email || ''));
  const { sessionToken: _removed, ...safe } = payload;
  return req.headers?.['x-orin-legacy-token'] === '1' ? payload : safe;
}
async function handler(req, res) {
  const path = Array.isArray(req.query?.path) ? req.query.path.join('/') : String(req.query?.path || '');
  if (path === 'password' && req.method === 'POST') {
    const state = await invoke(passwordHandler, req);
    if (state.status >= 400) return res.status(state.status).json(state.body);
    return res.status(200).json(await establishBff(req, res, state.body));
  }
  if (path === 'neon' && req.method === 'POST') {
    const state = await invoke(neonHandler, req);
    if (state.status >= 400) return res.status(state.status).json(state.body);
    return res.status(200).json(await establishBff(req, res, state.body));
  }
  if (path === 'device' && req.method === 'POST') return deviceHandler(req, res);
  if (path === 'session/introspect' && (req.method === 'GET' || req.method === 'POST')) {
    const identity = await requireUser(req);
    return res.status(200).json({ uid: identity.uid, email: identity.email || '', kind: identity.typ || 'session' });
  }
  if (path === 'mcp/verify' && req.method === 'POST') {
    const identity = await verifyMcpAuthorization(req);
    return res.status(200).json({ uid: identity.uid, scopes: identity.scopes });
  }
  if (path === 'mcp' && req.method === 'POST') {
    requireCsrf(req);
    return handleMcpManagement(req, res, String(req.body?.action || ''));
  }
  if (path === 'session/rotate' && req.method === 'POST') { requireCsrf(req); return res.status(200).json(await rotateBffSession(req, res)); }
  if (path === 'logout' && req.method === 'POST') { requireCsrf(req); return res.status(200).json(await revokeBffSession(req, res, false)); }
  if (path === 'account/sessions' && req.method === 'GET') return res.status(200).json({ sessions: [await resolveBffSession(req)] });
  if (path === 'account/sessions/revoke-all' && req.method === 'POST') { requireCsrf(req); return res.status(200).json(await revokeBffSession(req, res, true)); }
  if (path === 'authorize' && req.method === 'GET') {
    const url = process.env.NEON_AUTH_AUTHORIZE_URL;
    if (!url) throw httpError(501, 'Neon Auth authorization is not configured');
    return res.status(200).json({ authorization_url: url, expires_at: Date.now() + 600_000 });
  }
  throw httpError(404, 'Unknown auth route');
}
export default apiHandler(handler);
