import { requireUser, httpError, bearerClaims, isDeviceBearer, requireDeviceScope } from './_lib/auth.js';
import { requireCsrf } from './_lib/bff.js';
import { handleChatV2, handleImageV2, handleTtsV2 } from './_lib/chatV2.js';
import { apiHandler } from './_lib/http.js';

export const config = { maxDuration: 60 };

async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'orin-chat', version: 2 });
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  if (process.env.ORIN_CHAT_V2 !== 'on') throw httpError(503, 'Chat is temporarily unavailable while the secure platform path is being activated.');
  const claims = bearerClaims(req);
  if (isDeviceBearer(req)) requireDeviceScope(req, ['chat:use', 'code:use']);
  else if (claims && !['session', 'device'].includes(String(claims.typ || 'session'))) throw httpError(403, 'This credential cannot access Chat.');
  else if (!claims) requireCsrf(req);
  const uid = await requireUser(req);
  const mode = (req.body || {}).mode;
  if (mode === 'image') return handleImageV2(req, res, uid);
  if (mode === 'tts') return handleTtsV2(req, res, uid);
  if (mode && mode !== 'chat') throw httpError(501, 'This legacy tool mode is not available on the secure Chat v2 path.');
  return handleChatV2(req, res, uid);
}

export default apiHandler(handler);
