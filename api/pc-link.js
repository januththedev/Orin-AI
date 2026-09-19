/**
 * POST /api/pc-link — pairs the Orin Code PC app with the user's Telegram.
 *
 * Actions (Bearer Firebase ID token, except claim/decide which carry the
 * server-only PC_LINK_SECRET because they originate from the bot webhook):
 *   start  {}                                    → { code } (10 min TTL)
 *   status {}                                    → { linked, chatId? }
 *   unlink {}                                    → { ok: true }
 *   push   { approvalId, tool, title, detail }   → forwards Approve/Deny
 *          buttons to the linked phone via the Orin Code bot
 *   poll   {}                                    → { decisions: [{ approvalId, approved }] }
 *   claim  { code, chat_id, secret }             → { ok: true } (bot → server)
 *   decide { approvalId, approved, secret }      → { ok } (bot → server)
 *
 * Env: PC_LINK_SECRET (long random; never leaves the server).
 */
import { requireUser, httpError } from './_lib/firebase.js';
import { apiHandler } from './_lib/http.js';
import { rateLimit } from './_lib/ratelimit.js';
import { createCode, claimCode, bindingFor, unbind, pushApproval, pollDecisions, decide } from './_lib/pclink.js';
import { sendTelegram } from './_lib/tg.js';

export const config = { maxDuration: 30 };

function checkSecret(body) {
  const expected = process.env.PC_LINK_SECRET || '';
  if (!expected || body?.secret !== expected) throw httpError(401, 'bad secret');
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const body = req.body || {};
  const { action } = body;

  // --- Bot → server (shared secret, no user session) -----------------------
  if (action === 'claim') {
    checkSecret(body);
    const { uid } = await claimCode(body.code, body.chat_id);
    return res.status(200).json({ ok: true, uid });
  }
  if (action === 'decide') {
    checkSecret(body);
    const ok = await decide(body.approvalId, body.approved);
    return res.status(200).json({ ok });
  }

  // --- PC app → server (signed-in user) ------------------------------------
  const decoded = await requireUser(req);
  const uid = decoded.uid;

  if (action === 'start') {
    if (!(await rateLimit(`pc-link:${uid}`, 10, 60_000))) throw httpError(429, 'Slow down');
    const code = await createCode(uid);
    return res.status(200).json({ code });
  }
  if (action === 'status') {
    const binding = await bindingFor(uid);
    return res.status(200).json({ linked: !!binding, chatId: binding?.chatId || null });
  }
  if (action === 'unlink') {
    await unbind(uid);
    return res.status(200).json({ ok: true });
  }
  if (action === 'push') {
    if (!(await rateLimit(`pc-push:${uid}`, 60, 60_000))) throw httpError(429, 'Slow down');
    const binding = await bindingFor(uid);
    if (!binding) throw httpError(404, 'Phone not linked');
    const { approvalId, tool, title, detail } = body;
    if (!approvalId) throw httpError(400, 'approvalId required');
    await pushApproval(uid, binding.chatId, { approvalId, tool, title, detail });
    const botToken = process.env.TELEGRAM_CODE_BOT_TOKEN || '';
    if (botToken) {
      await sendTelegram(botToken, 'sendMessage', {
        chat_id: binding.chatId,
        text: `Orin Code asks:\n${title || tool}\n${(detail || '').slice(0, 500)}`,
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `pc:approve:${approvalId}` },
            { text: '❌ Deny', callback_data: `pc:deny:${approvalId}` },
          ]],
        },
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }
  if (action === 'poll') {
    const decisions = await pollDecisions(uid);
    return res.status(200).json({ decisions });
  }

  throw httpError(400, 'Unknown action');
}

export default apiHandler(handler);
