import crypto from 'node:crypto';
import { mintSession, verifySessionPayload, requireUser, httpError } from './auth.js';
import { sdocGet, sdocSet, sdocDelete, squery, TS } from './store.js';

export const MCP_SCOPES = ['models:read', 'chat:generate', 'usage:read'];
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export async function verifyMcpAuthorization(req) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw httpError(401, 'MCP credential required.');
  const claims = verifySessionPayload(token);
  if (claims.iss !== 'orin' || claims.typ !== 'mcp' || !claims.jti) throw httpError(401, 'Not an MCP credential.');
  const record = await sdocGet('mcp_credentials', String(claims.jti));
  if (!record.exists || String(record.data()?.hash) !== hash(token)) throw httpError(401, 'MCP credential revoked.');
  const scopes = Array.isArray(claims.scopes) ? claims.scopes.filter((scope) => MCP_SCOPES.includes(scope)) : [];
  if (!scopes.length) throw httpError(403, 'MCP credential has no valid scopes.');
  return { uid: String(claims.uid), email: String(claims.email || ''), jti: String(claims.jti), scopes };
}

export function requireMcpScope(identity, scope) {
  if (!identity.scopes.includes(scope)) throw httpError(403, `MCP scope ${scope} is required.`);
}

export async function handleMcpManagement(req, res, action) {
  const user = await requireUser(req);
  if (action === 'list') {
    const docs = await squery('mcp_credentials', [{ field: 'uid', value: user.uid }], { limit: 50 });
    return res.status(200).json({ tokens: docs.map((doc) => { const data = doc.data() || {}; return { id: doc.id, name: data.name || '', scopes: data.scopes || [], prefix: data.prefix || '', createdAt: data.createdAt || 0, lastUsedAt: data.lastUsedAt || 0 }; }) });
  }
  if (action === 'create' || action === 'rotate') {
    const requested = action === 'rotate' ? null : Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : [];
    let previous = null;
    if (action === 'rotate') {
      const id = String(req.body?.id || '');
      const existing = await sdocGet('mcp_credentials', id);
      if (!existing.exists || String(existing.data()?.uid) !== user.uid) throw httpError(404, 'MCP token not found.');
      previous = existing.data();
      await sdocDelete('mcp_credentials', id);
    }
    const scopes = [...new Set((requested.length ? requested : previous?.scopes || []).filter((scope) => MCP_SCOPES.includes(scope)))];
    if (!scopes.length) throw httpError(400, `Select at least one scope: ${MCP_SCOPES.join(', ')}`);
    const existingCount = action === 'rotate' ? 9 : (await squery('mcp_credentials', [{ field: 'uid', value: user.uid }], { limit: 100 })).length;
    if (existingCount >= 10) throw httpError(409, 'MCP token limit reached.');
    const jti = `mcp_${crypto.randomBytes(12).toString('hex')}`;
    const token = mintSession(user.uid, { email: user.email || '', typ: 'mcp', jti, scopes, expDays: 90 });
    const name = String(action === 'rotate' ? previous?.name || req.body?.name || 'MCP token' : req.body?.name || 'MCP token').trim().slice(0, 60) || 'MCP token';
    await sdocSet('mcp_credentials', jti, { uid: user.uid, name, scopes, prefix: token.slice(-12), hash: hash(token), createdAt: TS(), lastUsedAt: 0 });
    return res.status(200).json({ token, id: jti, name, scopes });
  }
  const id = String(req.body?.id || '');
  const record = await sdocGet('mcp_credentials', id);
  if (!record.exists || String(record.data()?.uid) !== user.uid) throw httpError(404, 'MCP token not found.');
  if (action === 'revoke') {
    await sdocDelete('mcp_credentials', id);
    return res.status(200).json({ ok: true });
  }
  if (action === 'rename') {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) throw httpError(400, 'Name is required.');
    await sdocSet('mcp_credentials', id, { name }, true);
    return res.status(200).json({ ok: true });
  }
  throw httpError(400, 'Unknown MCP management action.');
}

export async function verifyMcpToken(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const identity = await verifyMcpAuthorization(req);
  await sdocSet('mcp_credentials', identity.jti, { lastUsedAt: TS() }, true);
  return identity;
}
