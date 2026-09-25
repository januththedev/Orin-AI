import { bindingForChat, cancelRun, claimCode, confirmRun, decide, draftRun, getRun } from './pclink.js';

const API_ORIGIN = 'https://api.telegram.org';

export async function sendTelegram(token, method, payload) {
  const secret = String(token || process.env.TELEGRAM_CODE_BOT_TOKEN || '');
  if (!secret) throw new Error('Telegram bot token is not configured');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(secret)) throw new Error('Telegram bot token is invalid');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_ORIGIN}/bot${secret}/${method}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(`Telegram ${method} failed`);
    return data.result;
  } finally { clearTimeout(timer); }
}

function callbackId(value) {
  const match = /^pc:(approve|deny):([a-f0-9]{16,64})$/.exec(String(value || ''));
  return match ? { approved: match[1] === 'approve', approvalId: match[2] } : null;
}

function runAction(value) {
  const match = /^pc:run:(confirm|cancel):([a-f0-9]{16,64})$/.exec(String(value || ''));
  return match ? { action: match[1], runId: match[2] } : null;
}

export async function handleTelegramUpdate(update) {
  const message = update?.message;
  const callback = update?.callback_query;
  const chatId = String(message?.chat?.id || callback?.message?.chat?.id || '');
  if (!chatId) return { handled: false };
  const token = process.env.TELEGRAM_CODE_BOT_TOKEN || '';

  if (message?.text && /^\/link\s+[A-Za-z0-9-]{4,12}$/i.test(message.text.trim())) {
    const code = message.text.trim().split(/\s+/)[1];
    try {
      const linked = await claimCode(code, chatId);
      await sendTelegram(token, 'sendMessage', { chat_id: chatId, text: `Orin Code is linked to this chat. Account ${linked.uid.slice(0, 8)}… is ready.` });
      return { handled: true, action: 'link' };
    } catch (error) {
      await sendTelegram(token, 'sendMessage', { chat_id: chatId, text: `Link failed: ${error.message}` });
      return { handled: true, action: 'link_error' };
    }
  }

  if (message?.text && /^\/task\s+/.test(message.text.trim())) {
    const binding = await bindingForChat(chatId);
    if (!binding?.uid) {
      await sendTelegram(token, 'sendMessage', { chat_id: chatId, text: 'Link this chat to Orin Code first with /link CODE.' });
      return { handled: true, action: 'task_unlinked' };
    }
    const instructions = message.text.trim().replace(/^\/task\s+/i, '').slice(0, 4000);
    if (!instructions) return { handled: false };
    const runId = await draftRun(binding.uid, chatId, instructions);
    await sendTelegram(token, 'sendMessage', {
      chat_id: chatId,
      text: `Run this task on ${binding.machineName || 'your linked PC'}?\n${instructions.slice(0, 1000)}`,
      reply_markup: { inline_keyboard: [[
        { text: '✅ Run', callback_data: `pc:run:confirm:${runId}` },
        { text: 'Cancel', callback_data: `pc:run:cancel:${runId}` },
      ]] },
    });
    return { handled: true, action: 'task_drafted' };
  }

  const approval = callbackId(callback?.data);
  if (approval) {
    const ok = await decide(approval.approvalId, approval.approved);
    await sendTelegram(token, 'answerCallbackQuery', { callback_query_id: callback.id, text: ok ? (approval.approved ? 'Approved' : 'Denied') : 'Request expired' });
    return { handled: true, action: 'approval' };
  }

  const run = runAction(callback?.data);
  if (run) {
    const draft = await getRun(run.runId);
    const binding = draft ? await bindingForChat(chatId) : null;
    if (!draft || !binding || String(draft.uid) !== String(binding.uid)) {
      await sendTelegram(token, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'This task is no longer available.' });
      return { handled: true, action: 'run_invalid' };
    }
    if (run.action === 'confirm') {
      const taskId = await confirmRun(run.runId, binding.uid);
      await sendTelegram(token, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Task queued for your PC.' });
      await sendTelegram(token, 'sendMessage', { chat_id: chatId, text: `Task ${taskId.slice(0, 8)}… queued. The PC will ask for approval before each mutating step.` });
    } else {
      await cancelRun(run.runId, binding.uid);
      await sendTelegram(token, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Task cancelled.' });
    }
    return { handled: true, action: `run_${run.action}` };
  }
  return { handled: false };
}
