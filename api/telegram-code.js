import crypto from 'node:crypto';
import { handleTelegramUpdate } from './_lib/tg.js';
import { apiHandler } from './_lib/http.js';

export const config = { maxDuration: 15 };

function validSecret(req) {
  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
  const supplied = String(req.headers?.['x-telegram-bot-api-secret-token'] || '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } });
  if (!validSecret(req)) return res.status(401).json({ error: { code: 'INVALID_WEBHOOK_SECRET', message: 'Webhook authentication failed.' } });
  const result = await handleTelegramUpdate(req.body?.update || req.body);
  return res.status(200).json({ ok: true, handled: result.handled });
}

export default apiHandler(handler);
