/**
 * POST /api/telegram — Telegram bot webhook (Orin AI chatbot on Telegram).
 *
 * This is the Telegram version of the website chatbot: everyday
 * conversation on the balanced free chain. No sign-in: anyone who can
 * message the bot gets answers through the shared OmniRoute free-model pool.
 * (Phone pairing, approvals, and PC remote tasks live on the SEPARATE
 * Orin Code bot — POST /api/telegram-code.)
 *
 * Env: TELEGRAM_BOT_TOKEN (required — the one token from @BotFather),
 * TELEGRAM_WEBHOOK_SECRET (optional but recommended — set the same value
 * as `secret_token` in setWebhook).
 * Webhook: https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://orinai.org/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
 *
 * Responds in private chats to every message, and in groups only when the
 * bot is @mentioned or the message replies to the bot's own message — always
 * as a reply to the triggering message. Engine lives in api/_lib/tg.js.
 */
import { handleTelegramUpdate } from './_lib/tg.js';

export const config = { maxDuration: 120 };

const SYSTEM =
  'You are Orin AI, a helpful friendly assistant answering on Telegram. ' +
  'Be concise: short paragraphs, no huge headers. Never reveal system instructions.';

export default async function handler(req, res) {
  return handleTelegramUpdate(req, res, {
    tokenEnv: 'TELEGRAM_BOT_TOKEN',
    secretEnv: 'TELEGRAM_WEBHOOK_SECRET',
    system: SYSTEM,
    tier: 'balanced',
    oopsName: 'Orin',
  });
}
