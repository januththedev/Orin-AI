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
  await db().collection('pc_bindings').doc(String(d.uid)).set({
    chatId: String(chatId),
    bot: 'code',
    createdAt: TS(),
  });
  await ref.delete().catch(() => {});
  return { uid: String(d.uid) };
}

export async function bindingFor(uid) {
  const snap = await db().collection('pc_bindings').doc(String(uid)).get();
  if (!snap.exists) return null;
  return snap.data();
}

export async function unbind(uid) {
  await db().collection('pc_bindings').doc(String(uid)).delete().catch(() => {});
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
