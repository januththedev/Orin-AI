/**
 * Shared Telegram webhook engine for both Orin bots (Orin AI chat bot +
 * Orin Code coding bot). Route files stay thin: they pass their token env,
 * secret env, system prompt, and chain tier — everything else (mention
 * gating, replies, chunking, model failover) lives here.
 */
import { route, chainFor } from './omni.js';

const TG_API = 'https://api.telegram.org';
const TG_LIMIT = 4000;

const usernameCache = new Map();

function tg(token, method, payload) {
  return fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json().catch(() => ({})))
    .catch(() => ({}));
}

async function meUsername(token) {
  if (usernameCache.has(token)) return usernameCache.get(token);
  let username = '';
  try {
    const me = await tg(token, 'getMe', {});
    if (me?.result?.username) username = me.result.username;
  } catch {}
  usernameCache.set(token, username);
  return username;
}

function chunk(text, limit = TG_LIMIT) {
  const parts = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Extract the human question: text/caption minus the @mention. */
function questionOf(message, username) {
  const raw = (message.text || message.caption || '').trim();
  if (!raw) return '';
  if (!username) return raw;
  return raw.replace(new RegExp(`@${username}\\b`, 'gi'), '').trim();
}

function mentioned(message, username) {
  if (!username) return false;
  const entities = [...(message.entities || []), ...(message.caption_entities || [])];
  const text = (message.text || message.caption || '');
  return entities.some(
    (e) => e.type === 'mention' && text.substr(e.offset, e.length).toLowerCase() === `@${username.toLowerCase()}`,
  );
}

/**
 * Handle one Telegram update. No sign-in: anyone who can message the bot
 * gets answers through the shared OmniRoute free pool.
 *
 * @param {object} opts
 * @param {string} opts.tokenEnv   env var holding the bot token
 * @param {string} opts.secretEnv  env var holding the webhook secret (optional)
 * @param {string} opts.system     system prompt (persona per bot)
 * @param {string} opts.tier       omni chain tier: 'balanced' | 'coding' | 'thinking'
 * @param {string} opts.oopsName   display name used in the failure message
 */
export async function handleTelegramUpdate(req, res, opts) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  const token = process.env[opts.tokenEnv] || '';
  const expected = (opts.secretEnv && process.env[opts.secretEnv]) || '';
  if (expected) {
    const got = req.headers['x-telegram-bot-api-secret-token'] || '';
    if (got !== expected) return res.status(401).json({ error: 'bad secret' });
  }

  // Ack fast so Telegram never retries; work continues async.
  res.status(200).json({ ok: true });
  if (!token) return;

  try {
    const update = req.body || {};
    const message = update.message || update.edited_message;
    if (!message || message.from?.is_bot) return;

    const chatType = message.chat?.type || 'private';
    const username = await meUsername(token);
    const isReplyToBot =
      !!message.reply_to_message &&
      (message.reply_to_message.from?.username === username || message.reply_to_message.from?.is_bot === true);
    const isMentioned = mentioned(message, username);

    if (chatType !== 'private' && !isMentioned && !isReplyToBot) return; // stay quiet

    let question = questionOf(message, username);
    const repliedText =
      message.reply_to_message?.text || message.reply_to_message?.caption || '';
    if (!question && repliedText && (isMentioned || isReplyToBot)) question = repliedText.trim();
    if (!question) return;

    const chatId = message.chat.id;
    const replyTo = message.message_id;
    await tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });

    let text = "I couldn't generate a response. Please try again.";
    try {
      const r = await route(await chainFor(opts.tier), [
        { role: 'system', content: opts.system },
        ...(repliedText && repliedText !== question
          ? [{ role: 'user', content: `Context they replied to: ${repliedText.slice(0, 1500)}` }]
          : []),
        { role: 'user', content: question },
      ]);
      if (r.text) text = r.text;
    } catch {
      text = `${opts.oopsName} is having trouble reaching its models right now. Try again in a minute.`;
    }

    for (const part of chunk(text)) {
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: part,
        reply_to_message_id: replyTo,
      });
    }
  } catch {
    // Already acked — never fail the webhook.
  }
}
