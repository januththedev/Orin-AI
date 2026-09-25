import crypto from 'node:crypto';
import { requireUser, httpError, isDeviceBearer, requireDeviceScope } from './_lib/auth.js';
import { requireCsrf } from './_lib/bff.js';
import { rateLimit } from './_lib/ratelimit.js';
import { apiHandler } from './_lib/http.js';
import { sendTelegram } from './_lib/tg.js';
import {
  bindingFor, cancelRun, claimCode, claimTask, confirmRun, createCode,
  decide, draftRun, finishTask, pollDecisions, pushApproval, registerMachine, unbind,
} from './_lib/pclink.js';

export const config = { maxDuration: 30 };

function botSecret(req) {
  const expected = String(process.env.ORIN_PC_LINK_SECRET || '');
  const supplied = String(req.headers?.['x-orin-pc-secret'] || '');
  if (!expected || expected.length < 32 || !supplied) throw httpError(503, 'PC link bot authentication is not configured');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(401, 'PC link bot authentication failed');
}

function machineId(body) {
  const value = String(body?.machine_id || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw httpError(400, 'A valid machine_id is required');
  return value;
}

async function pcIdentity(req, body) {
  if (isDeviceBearer(req)) requireDeviceScope(req, ['code:use']);
  else requireCsrf(req);
  const identity = await requireUser(req);
  const binding = await bindingFor(identity.uid);
  if (body?.machine_id && binding?.machineId && String(binding.machineId) !== String(body.machine_id)) throw httpError(403, 'Machine is not linked to this account');
  return { identity, binding };
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  res.setHeader('Cache-Control', 'no-store');
  const body = req.body || {};
  const action = String(body.action || '');

  // Bot/webhook-only actions never accept a secret in the JSON body.
  if (['claim', 'decide', 'draft', 'confirm', 'cancel'].includes(action)) {
    botSecret(req);
    if (action === 'claim') return res.status(200).json({ ok: true, uid: (await claimCode(body.code, body.chat_id)).uid });
    if (action === 'decide') return res.status(200).json({ ok: await decide(String(body.approvalId || ''), body.approved === true) });
    if (action === 'draft') return res.status(200).json({ runId: await draftRun(String(body.uid || ''), String(body.chat_id || ''), String(body.instructions || '').slice(0, 4000)) });
    if (action === 'confirm') return res.status(200).json({ taskId: await confirmRun(String(body.runId || ''), String(body.uid || '')) });
    return res.status(200).json({ ok: await cancelRun(String(body.runId || ''), String(body.uid || '')) });
  }

  const { identity, binding } = await pcIdentity(req, body);
  const uid = identity.uid;
  if (action === 'start') {
    if (!(await rateLimit(`pc-link:${uid}`, 10, 60_000))) throw httpError(429, 'Slow down');
    const code = await createCode(uid);
    const registered = await registerMachine(uid, machineId(body), String(body.machine_name || 'My PC').slice(0, 80));
    const current = await bindingFor(uid);
    return res.status(200).json({ code, linked: !!current?.chatId, deviceSecret: registered.deviceSecret });
  }
  if (action === 'status') return res.status(200).json({ linked: !!binding?.chatId, chatId: binding?.chatId || null, machineName: binding?.machineName || null });
  if (action === 'unlink') { await unbind(uid); return res.status(200).json({ ok: true }); }
  if (action === 'push') {
    if (!(await rateLimit(`pc-push:${uid}`, 60, 60_000))) throw httpError(429, 'Slow down');
    if (!binding?.chatId) throw httpError(404, 'Phone not linked');
    if (!body.approvalId || !/^[A-Za-z0-9_-]{8,128}$/.test(String(body.approvalId))) throw httpError(400, 'approvalId required');
    await pushApproval(uid, binding.chatId, { approvalId: body.approvalId, tool: body.tool, title: body.title, detail: body.detail });
    const token = process.env.TELEGRAM_CODE_BOT_TOKEN || '';
    if (token) await sendTelegram(token, 'sendMessage', {
      chat_id: binding.chatId,
      text: `Orin Code asks:\n${String(body.title || body.tool || '').slice(0, 200)}\n${String(body.detail || '').slice(0, 900)}`,
      reply_markup: { inline_keyboard: [[
        { text: '✅ Approve', callback_data: `pc:approve:${body.approvalId}` },
        { text: '❌ Deny', callback_data: `pc:deny:${body.approvalId}` },
      ]] },
    }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  if (action === 'poll') return res.status(200).json({ decisions: await pollDecisions(uid) });
  if (action === 'task_poll') {
    const task = await claimTask(uid, machineId(body));
    if (!task) return res.status(200).json({ task: null });
    return res.status(200).json({ task: { taskId: task.id, instructions: task.instructions, approvalGrant: task.approvalGrant, machineId: task.machineId } });
  }
  if (action === 'task_result') {
    const taskId = String(body.taskId || '');
    if (!/^[a-f0-9]{16,64}$/.test(taskId)) throw httpError(400, 'taskId required');
    const finished = await finishTask(taskId, uid, machineId(body), body.ok !== false, String(body.summary || '').slice(0, 4000));
    if (!finished) throw httpError(404, 'Unknown task');
    const token = process.env.TELEGRAM_CODE_BOT_TOKEN || '';
    if (token && finished.chatId) await sendTelegram(token, 'sendMessage', {
      chat_id: finished.chatId,
      text: `${finished.status === 'done' ? '✅ Done on your PC' : '❌ Failed on your PC'}:\n${String(finished.result || '').slice(0, 3500)}`,
    }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  throw httpError(400, 'Unknown action');
}

export default apiHandler(handler);
