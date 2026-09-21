/**
 * Neon/Postgres store for the PC ↔ Telegram link (Orin Code bot).
 *
 * Docs (mirroring the old Firestore collections):
 *   pc_links/{code}      { uid, chatId, bot, createdAt } — pairing codes, 10 min TTL
 *   pc_bindings/{uid}    { chatId, bot, createdAt }      — active phone link per user
 *   pc_inbox/{approval}  { uid, chatId, tool, title, detail, decision, createdAt }
 *                        — approval requests; decision null until the user taps
 *                        a button. Consumed (deleted) on PC poll.
 */
import crypto from 'crypto';
import { sdocGet, sdocSet, sdocUpdate, sdocDelete, squery, TS } from './store.js';

const CODE_TTL_MS = 10 * 60_000;
const INBOX_TTL_MS = 15 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

export async function createCode(uid) {
  const code = randomCode();
  await sdocSet('pc_links', code, {
    uid,
    chatId: null,
    bot: 'code',
    createdAt: TS(),
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
}

/** Claim a pairing code from the bot. Returns { uid } or throws. */
export async function claimCode(code, chatId) {
  const normalized = String(code || '').trim().toUpperCase();
  const snap = await sdocGet('pc_links', normalized);
  if (!snap.exists) throw Object.assign(new Error('Unknown code — check it in the PC app and try again.'), { code: 404 });
  const d = snap.data();
  if (Number(d.expiresAt) < Date.now()) {
    await sdocDelete('pc_links', normalized).catch(() => {});
    throw Object.assign(new Error('That code expired — generate a fresh one in the PC app.'), { code: 410 });
  }
  // Bind this chat to the user (merging any machine identity the PC sent).
  const uid = String(d.uid);
  const existing = await sdocGet('pc_bindings', uid).catch(() => null);
  const already = existing && existing.exists ? existing.data() : {};
  await sdocSet('pc_bindings', uid, {
    chatId: String(chatId),
    bot: 'code',
    machineId: already.machineId || '',
    machineName: already.machineName || '',
    createdAt: already.createdAt || TS(),
    linkedAt: TS(),
  }).catch(() => {});
  await sdocDelete('pc_links', normalized).catch(() => {});
  return { uid };
}

export async function bindingFor(uid) {
  const snap = await sdocGet('pc_bindings', String(uid));
  if (!snap.exists) return null;
  return snap.data();
}

/** Reverse lookup: binding by Telegram chat id (bot side). */
export async function bindingForChat(chatId) {
  const docs = await squery('pc_bindings', [{ field: 'chatId', value: String(chatId) }], { limit: 1 }).catch(() => []);
  if (!docs.length) return null;
  return { uid: docs[0].id, ...docs[0].data() };
}

export async function unbind(uid) {
  await sdocDelete('pc_bindings', String(uid)).catch(() => {});
  // Pending tasks die with the link — a stolen phone moment ends here.
  const tasks = await squery('pc_tasks', [{ field: 'uid', value: String(uid) }], { limit: 500 }).catch(() => []);
  for (const t of tasks) {
    await sdocDelete('pc_tasks', t.id).catch(() => {});
  }
}

export async function pushApproval(uid, chatId, item) {
  await sdocSet('pc_inbox', String(item.approvalId), {
    uid: String(uid),
    chatId: String(chatId),
    tool: String(item.tool || ''),
    title: String(item.title || '').slice(0, 200),
    detail: String(item.detail || '').slice(0, 1000),
    decision: null,
    createdAt: TS(),
    expiresAt: Date.now() + INBOX_TTL_MS,
  });
}

/** Returns pending decisions for uid and consumes them. */
export async function pollDecisions(uid) {
  const docs = await squery('pc_inbox', [{ field: 'uid', value: String(uid) }], { limit: 100 });
  const out = [];
  for (const doc of docs) {
    const d = doc.data();
    if (Number(d.expiresAt) < Date.now()) {
      await sdocDelete('pc_inbox', doc.id).catch(() => {});
      continue;
    }
    if (d.decision === true || d.decision === false) {
      out.push({ approvalId: doc.id, approved: d.decision });
      await sdocDelete('pc_inbox', doc.id).catch(() => {});
    }
  }
  return out;
}

export async function decide(approvalId, approved) {
  const snap = await sdocGet('pc_inbox', String(approvalId));
  if (!snap.exists) return false;
  await sdocUpdate('pc_inbox', String(approvalId), { decision: !!approved, decidedAt: TS() }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Remote tasks: phone → PC. A task runs ONLY on the machine named in the
// binding, ONLY from the bound chat, and ONLY after an explicit confirm tap.
// Every state change is a separate doc write so the audit trail survives.
// ---------------------------------------------------------------------------

const TASK_TTL_MS = 30 * 60_000;

/** Register/update this PC under the user's binding. Called on link start. */
export async function registerMachine(uid, machineId, machineName) {
  const snap = await sdocGet('pc_bindings', String(uid));
  const patch = {
    machineId: String(machineId || ''),
    machineName: String(machineName || 'My PC').slice(0, 80),
    machineSeenAt: TS(),
  };
  if (snap.exists) await sdocUpdate('pc_bindings', String(uid), patch).catch(() => {});
  else await sdocSet('pc_bindings', String(uid), { chatId: null, bot: 'code', createdAt: TS(), ...patch }).catch(() => {});
}

/** Draft a phone task awaiting the user's confirm tap. Returns runId. */
export async function draftRun(uid, chatId, instructions) {
  const runId = crypto.randomBytes(16).toString('hex');
  await sdocSet('pc_runs', runId, {
    uid: String(uid),
    chatId: String(chatId),
    instructions: String(instructions).slice(0, 4000),
    status: 'proposed',
    createdAt: TS(),
    expiresAt: Date.now() + TASK_TTL_MS,
  });
  return runId;
}

export async function getRun(runId) {
  const snap = await sdocGet('pc_runs', String(runId));
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Confirm a draft → queued task for the bound machine. Single-use. */
export async function confirmRun(runId, uid) {
  const snap = await sdocGet('pc_runs', String(runId));
  if (!snap.exists) throw Object.assign(new Error('Run not found.'), { code: 404 });
  const d = snap.data();
  if (String(d.uid) !== String(uid)) throw Object.assign(new Error('Not your run.'), { code: 403 });
  if (d.status !== 'proposed') throw Object.assign(new Error('Already handled.'), { code: 409 });
  if (Number(d.expiresAt) < Date.now()) throw Object.assign(new Error('Expired.'), { code: 410 });
  const taskId = crypto.randomBytes(16).toString('hex');
  await sdocSet('pc_tasks', taskId, {
    uid: String(uid),
    chatId: String(d.chatId || ''),
    instructions: d.instructions,
    status: 'queued',
    runId,
    createdAt: TS(),
    expiresAt: Date.now() + TASK_TTL_MS,
  });
  await sdocUpdate('pc_runs', String(runId), { status: 'confirmed', taskId }).catch(() => {});
  return taskId;
}

export async function cancelRun(runId, uid) {
  const snap = await sdocGet('pc_runs', String(runId));
  if (!snap.exists) return false;
  if (String(snap.data().uid) !== String(uid)) return false;
  await sdocUpdate('pc_runs', String(runId), { status: 'cancelled' }).catch(() => {});
  return true;
}

/** PC long-polls this: oldest queued, unexpired task for MY machine. */
export async function claimTask(uid, machineId) {
  const docs = await squery(
    'pc_tasks',
    [{ field: 'uid', value: String(uid) }, { field: 'status', value: 'queued' }],
    { limit: 100 },
  );
  const now = Date.now();
  const queued = docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => !(Number(t.expiresAt) < now))
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  // Machine scoping: prefer tasks with no machine yet (bind first claim),
  // else only tasks already assigned to THIS machine.
  const mine =
    queued.find((t) => !t.machineId) || queued.find((t) => String(t.machineId) === String(machineId));
  if (!mine) return null;
  // Conditional claim: only one PC wins even if two poll at once.
  const check = await sdocGet('pc_tasks', mine.id);
  if (!check.exists || check.data().status !== 'queued') return null;
  await sdocUpdate('pc_tasks', mine.id, {
    status: 'running',
    machineId: String(machineId),
    startedAt: TS(),
  }).catch(() => {});
  return mine;
}

/** PC reports back: delivers the result text for the bot to forward. */
export async function finishTask(taskId, uid, ok, summary) {
  const snap = await sdocGet('pc_tasks', String(taskId));
  if (!snap.exists || String(snap.data().uid) !== String(uid)) return null;
  const data = { status: ok ? 'done' : 'failed', result: String(summary || '').slice(0, 4000) };
  await sdocUpdate('pc_tasks', String(taskId), { ...data, finishedAt: TS() }).catch(() => {});
  return { ...snap.data(), ...data };
}
