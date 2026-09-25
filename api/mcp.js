import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import { httpError } from './_lib/auth.js';
import { verifyMcpAuthorization, requireMcpScope } from './_lib/mcpAuth.js';
import { sdocGet, sdocSet, TS } from './_lib/store.js';
import { apiHandler } from './_lib/http.js';

export const config = { maxDuration: 60 };
const ROUTER_BASE = 'https://router.orinai.org';
const ALIASES = ['orin-cheap', 'orin-balanced', 'orin-thinking', 'orin-coding'];

async function assertion(uid, usageReservationId) {
  const key = process.env.ORIN_ROUTER_SERVICE_SIGNING_KEY || '';
  if (key.length < 32) throw httpError(503, 'Router service signing is not configured.');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: 'service', scope: 'router:invoke', account_id: uid, usage_reservation_id: usageReservationId, token_version: 0, auth_method: 'orin-core' })
    .setProtectedHeader({ alg: 'HS256', kid: process.env.ORIN_SERVICE_KEY_ID || 'core-v1' })
    .setIssuer('orin-core').setAudience('orin-router').setSubject(uid).setJti(crypto.randomUUID()).setIssuedAt(now).setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(key));
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const identity = await verifyMcpAuthorization(req);
  const action = String(req.body?.action || '');
  if (action === 'models') {
    requireMcpScope(identity, 'models:read');
    return res.status(200).json({ object: 'list', data: ALIASES.map((id) => ({ id, object: 'model', owned_by: 'orin' })) });
  }
  if (action === 'usage') {
    requireMcpScope(identity, 'usage:read');
    const snap = await sdocGet('users', identity.uid);
    const usage = snap.exists ? snap.data()?.usage_v2 || { text: 0, image: 0, tts: 0 } : { text: 0, image: 0, tts: 0 };
    return res.status(200).json({ text: usage.text || 0, images: usage.image || 0, videos: 0 });
  }
  if (action !== 'chat') throw httpError(400, 'Unknown MCP action.');
  requireMcpScope(identity, 'chat:generate');
  const model = String(req.body?.model || 'orin-balanced');
  if (!ALIASES.includes(model)) throw httpError(400, 'Unknown Orin model alias.');
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length || messages.length > 200) throw httpError(400, 'messages must contain 1–200 items.');
  const clean = messages.map((item) => {
    if (!item || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 100000) throw httpError(400, 'Invalid MCP message.');
    return { role: item.role, content: item.content };
  });
  const account = await sdocGet('users', identity.uid);
  if (!account.exists) throw httpError(401, 'Account not found.');
  const usage = { ...(account.data()?.usage_v2 || { text: 0, image: 0, tts: 0 }) };
  usage.text = (usage.text || 0) + 1;
  await sdocSet('users', identity.uid, { usage_v2: usage, lastUpdated: TS() }, true);
  const usageReservationId = `mcp_${crypto.randomUUID()}`;
  const preview = process.env.ORIN_PROVIDER_MODE === 'fake';
  const token = preview ? 'preview-service' : await assertion(identity.uid, usageReservationId);
  const response = await fetch(`${ROUTER_BASE}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(preview ? { 'x-orin-preview-service': '1' } : {}) }, body: JSON.stringify({ model, messages: clean, stream: false, ...(Number.isFinite(req.body?.temperature) ? { temperature: req.body.temperature } : {}), ...(Number.isInteger(req.body?.max_tokens) ? { max_tokens: req.body.max_tokens } : {}) }), signal: AbortSignal.timeout(50_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status >= 500 ? 503 : response.status, data?.error?.message || 'Router request failed.');
  return res.status(200).json(data);
}

export default apiHandler(handler);
