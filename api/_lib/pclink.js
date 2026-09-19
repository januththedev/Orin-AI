/**
 * Firestore store for the PC ↔ Telegram link (Orin Code bot).
 *
 * Collections:
 *   pc_links/{code}      { uid, chatId, bot, createdAt } — pairing codes, 10 min TTL
 *   pc_bindings/{uid}    { chatId, bot, createdAt }      — active phone link per user
 *   pc_inbox/{approval}  { uid, chatId, tool, title, detail, decision, createdAt }
 *                        — approval requests; decision null until the user taps
 *                        a button. Consumed (deleted) on PC poll.
 */
import crypto from 'crypto';
import { db, TS } from './firebase.js';

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
  await db().collection('pc_links').doc(code).set({
    uid,
    chatId: null,
    bot: 'code',
    createdAt: TS(),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

/** Claim a pairing code from the bot. Returns { uid } or throws. */
export async function claimCode(code, chatId) {
  const normalized = String(code || '').trim().toUpperCase();
  const ref = db().collection('pc_links').doc(normalized);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('Unknown code — check it in the PC app and try again.'), { code: 404 });
  const d = snap.data();
  if (d.expiresAt?.toMillis?.() < Date.now()) {
    await ref.delete().catch(() => {});
    throw Object.assign(new Error('That code expired — generate a fresh one in the PC app.'), { code: 410 });
  }
  // Bind this chat to the user (merging any machine identity the PC sent).
  const uid = String(d.uid);
  const binding = db().collection('pc_bindings').doc(uid);
  const existing = await binding.get().catch(() => null);
  const already = existing && existing.exists ? existing.data() : {};
  await binding.set({
    chatId: String(chatId),
    bot: 'code',
    machineId: already.machineId || '',
    machineName: already.machineName || '',
    createdAt: already.createdAt || TS(),
    linkedAt: TS(),
  }).catch(() => {});
  await ref.delete().catch(() => {});
  return { uid };
}

export async function bindingFor(uid) {
  const snap = await db().collection('pc_bindings').doc(String(uid)).get();
  if (!snap.exists) return null;
  return snap.data();
}

/** Reverse lookup: binding by Telegram chat id (bot side). */
export async function bindingForChat(chatId) {
  const q = await db().collection('pc_bindings').where('chatId', '==', String(chatId)).limit(1).get().catch(() => null);
  if (!q || q.empty) return null;
  return { uid: q.docs[0].id, ...q.docs[0].data() };
}

export async function unbind(uid) {
  await db().collection('pc_bindings').doc(String(uid)).delete().catch(() => {});
  // Pending tasks die with the link — a stolen phone moment ends here.
  const q = await db().collection('pc_tasks').where('uid', '==', String(uid)).get().catch(() => null);
  if (q) {
    const batch = db().batch();
    q.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit().catch(() => {});
  }
}

export async function pushApproval(uid, chatId, item) {
  await db().collection('pc_inbox').doc(String(item.approvalId)).set({
    uid: String(uid),
    chatId: String(chatId),
    tool: String(item.tool || ''),
    title: String(item.title || '').slice(0, 200),
    detail: String(item.detail || '').slice(0, 1000),
    decision: null,
    createdAt: TS(),
    expiresAt: new Date(Date.now() + INBOX_TTL_MS),
  });
}

/** Returns pending decisions for uid and consumes them. */
export async function pollDecisions(uid) {
  const q = await db().collection('pc_inbox').where('uid', '==', String(uid)).get();
  const out = [];
  const batch = db().batch();
  let touched = false;
  for (const doc of q.docs) {
    const d = doc.data();
    if (d.expiresAt?.toMillis?.() < Date.now()) {
      batch.delete(doc.ref);
      touched = true;
      continue;
    }
    if (d.decision === true || d.decision === false) {
      out.push({ approvalId: doc.id, approved: d.decision });
      batch.delete(doc.ref);
      touched = true;
    }
  }
  if (touched) await batch.commit().catch(() => {});
  return out;
}

export async function decide(approvalId, approved) {
  const ref = db().collection('pc_inbox').doc(String(approvalId));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update({ decision: !!approved, decidedAt: TS() }).catch(() => {});
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
  const ref = db().collection('pc_bindings').doc(String(uid));
  const snap = await ref.get();
  const patch = {
    machineId: String(machineId || ''),
    machineName: String(machineName || 'My PC').slice(0, 80),
    machineSeenAt: TS(),
  };
  if (snap.exists) await ref.update(patch).catch(() => {});
  else await ref.set({ chatId: null, bot: 'code', createdAt: TS(), ...patch }).catch(() => {});
}

/** Draft a phone task awaiting the user's confirm tap. Returns runId. */
export async function draftRun(uid, chatId, instructions) {
  const runId = crypto.randomBytes(16).toString('hex');
  await db().collection('pc_runs').doc(runId).set({
    uid: String(uid),
    chatId: String(chatId),
    instructions: String(instructions).slice(0, 4000),
    status: 'proposed',
    createdAt: TS(),
    expiresAt: new Date(Date.now() + TASK_TTL_MS),
  });
  return runId;
}

export async function getRun(runId) {
  const snap = await db().collection('pc_runs').doc(String(runId)).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Confirm a draft → queued task for the bound machine. Single-use. */
export async function confirmRun(runId, uid) {
  const ref = db().collection('pc_runs').doc(String(runId));
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('Run not found.'), { code: 404 });
  const d = snap.data();
  if (String(d.uid) !== String(uid)) throw Object.assign(new Error('Not your run.'), { code: 403 });
  if (d.status !== 'proposed') throw Object.assign(new Error('Already handled.'), { code: 409 });
  if (d.expiresAt?.toMillis?.() < Date.now()) throw Object.assign(new Error('Expired.'), { code: 410 });
  const taskId = crypto.randomBytes(16).toString('hex');
  await db().collection('pc_tasks').doc(taskId).set({
    uid: String(uid),
    chatId: String(d.chatId || ''),
    instructions: d.instructions,
    status: 'queued',
    runId,
    createdAt: TS(),
    expiresAt: new Date(Date.now() + TASK_TTL_MS),
  });
  await ref.update({ status: 'confirmed', taskId }).catch(() => {});
  return taskId;
}

export async function cancelRun(runId, uid) {
  const ref = db().collection('pc_runs').doc(String(runId));
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (String(snap.data().uid) !== String(uid)) return false;
  await ref.update({ status: 'cancelled' }).catch(() => {});
  return true;
}

/** PC long-polls this: oldest queued, unexpired task for MY machine. */
export async function claimTask(uid, machineId) {
  const q = await db()
    .collection('pc_tasks')
    .where('uid', '==', String(uid))
    .where('status', '==', 'queued')
    .get();
  const now = Date.now();
  const docs = q.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => !(t.expiresAt?.toMillis?.() < now))
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  // Machine scoping: prefer tasks with no machine yet (bind first claim),
  // else only tasks already assigned to THIS machine.
  const mine =
    docs.find((t) => !t.machineId) || docs.find((t) => String(t.machineId) === String(machineId));
  if (!mine) return null;
  await db().collection('pc_tasks').doc(mine.id).update({
    status: 'running',
    machineId: String(machineId),
    startedAt: TS(),
  }).catch(() => {});
  return mine;
}

/** PC reports back: delivers the result text for the bot to forward. */
export async function finishTask(taskId, uid, ok, summary) {
  const ref = db().collection('pc_tasks').doc(String(taskId));
  const snap = await ref.get();
  if (!snap.exists || String(snap.data().uid) !== String(uid)) return null;
  const data = { status: ok ? 'done' : 'failed', result: String(summary || '').slice(0, 4000) };
  await ref.update({ ...data, finishedAt: TS() }).catch(() => {});
  return { ...snap.data(), ...data };
}
