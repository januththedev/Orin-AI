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

/** Raw Bot API call with an explicit token (used by pc-link pushes). */
export function sendTelegram(token, method, payload) {
  if (!token) return Promise.resolve({});
  return tg(token, method, payload);
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
 * @param {boolean} [opts.linkBot] also handle /link pairing codes and
 *   pc:approve:/pc:deny: buttons (Orin Code bot only). Needs PC_LINK_SECRET
 *   plus ./pclink.js; failures here never break normal Q&A.
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

    // Inline approval buttons (Orin Code bot): pc:approve:<id> / pc:deny:<id>.
    if (update.callback_query && opts.linkBot) {
      await handleCallback(token, update.callback_query).catch(() => {});
      return;
    }

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

    // /link CODE — pair this chat with the user's PC app (Orin Code bot).
    if (opts.linkBot && /^\/link(\s|$)/i.test(question)) {
      await handleLinkCommand(token, message, question);
      return;
    }
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

    // Orin Code bot: task-like messages from a LINKED chat get a one-tap
    // "run it on the PC" offer. Nothing runs without the confirm tap.
    if (opts.remoteRuns && looksLikeTask(question)) {
      try {
        const { bindingForChat, draftRun } = await import('./pclink.js');
        const binding = await bindingForChat(chatId);
        if (binding?.machineId) {
          const runId = await draftRun(binding.uid, chatId, question);
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `Run this on ${binding.machineName || 'your PC'}?`,
            reply_to_message_id: replyTo,
            reply_markup: {
              inline_keyboard: [[
                { text: '▶ Run on PC', callback_data: `pc:run:${runId}` },
                { text: '✖ Cancel', callback_data: `pc:cancel:${runId}` },
              ]],
            },
          });
        }
      } catch {}
    }
  } catch {
    // Already acked — never fail the webhook.
  }
}

/** Task-like opener verbs — keeps the Run offer off pure chit-chat. */
const TASK_VERBS = /^(fix|change|update|add|create|build|refactor|rewrite|run|edit|delete|remove|rename|move|install|clean|deploy|commit|push|test|debug|migrate|convert|implement|write|generate|make|set up|setup|configure|please)\b/i;

function looksLikeTask(question) {
  const first = String(question || '').trim().split('\n')[0].slice(0, 120);
  return TASK_VERBS.test(first) && first.length > 12;
}

/** /link CODE — claim a PC pairing code for this chat. */
async function handleLinkCommand(token, message, question) {
  const chatId = message.chat.id;
  const code = (question.replace(/^\/link\s*/i, '').trim() || '').toUpperCase();
  const reply = async (text) => {
    await tg(token, 'sendMessage', { chat_id: chatId, text, reply_to_message_id: message.message_id });
  };
  if (!code) {
    await reply('Send /link followed by the 6-letter code from Orin Code → Settings → Notifications.');
    return;
  }
  try {
    const { claimCode } = await import('./pclink.js');
    await claimCode(code, chatId);
    await reply('✅ Phone linked! Agent approvals from your PC will arrive here with Approve / Deny buttons.');
  } catch (e) {
    await reply(`Couldn't link: ${e?.message || 'try a fresh code from the PC app.'}`);
  }
}

/** Approve/Deny + Run/Cancel button taps. */
async function handleCallback(token, callback) {
  const chatId = callback.message?.chat?.id;
  const id = callback.id;
  const answer = async (text) => {
    await tg(token, 'answerCallbackQuery', { callback_query_id: id, text });
  };
  const data = String(callback.data || '');

  // Remote task confirm/cancel (Orin Code bot): pc:run:<runId> / pc:cancel:<runId>.
  // The run's own chat must match this chat — cross-chat taps are refused.
  let runMatch = /^(pc:run|pc:cancel):(.+)$/.exec(data);
  if (runMatch) {
    try {
      const { getRun, confirmRun, cancelRun } = await import('./pclink.js');
      const run = await getRun(runMatch[2]);
      if (!run || String(run.chatId) !== String(chatId)) {
        await answer('Not your run.');
        return;
      }
      if (runMatch[1] === 'pc:cancel') {
        await cancelRun(runMatch[2], run.uid);
        await answer('Cancelled.');
        await editRunMessage(token, callback, 'Cancelled — nothing will run.');
        return;
      }
      const taskId = await confirmRun(runMatch[2], run.uid);
      await answer('Sent to your PC ✓');
      await editRunMessage(token, callback, `Sent to ${run.machineName || 'your PC'} — I'll report back here when it's done.`);
      void taskId;
    } catch (e) {
      await answer(e?.message || 'Failed.');
    }
    return;
  }

  const match = /^(pc:approve|pc:deny):(.+)$/.exec(data);
  if (!match) {
    await answer('Unknown button.');
    return;
  }
  const [, action, approvalId] = match;
  const approved = action === 'pc:approve';
  try {
    const { decide } = await import('./pclink.js');
    const ok = await decide(approvalId, approved);
    await answer(ok ? (approved ? 'Approved ✓' : 'Denied.') : 'Already resolved.');
    await editRunMessage(
      token,
      callback,
      ok ? (approved ? 'Approved' : 'Denied') : 'Already resolved.',
    );
  } catch {
    await answer('Failed — try again.');
  }
}

async function editRunMessage(token, callback, suffix) {
  const chatId = callback.message?.chat?.id;
  if (chatId && callback.message?.message_id) {
    await tg(token, 'editMessageText', {
      chat_id: chatId,
      message_id: callback.message.message_id,
      text: `${callback.message.text || 'Orin Code asks'}\n\n${suffix}`,
    });
  }
}
