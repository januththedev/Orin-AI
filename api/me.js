/**
 * /api/me — the signed-in user's own state, one function.
 * (Vercel Hobby caps deployments at 12 functions; session + history share
 * this route instead of two.)
 *
 * GET  → { history: Conversation[] | null, memory: string }
 * POST { action: 'sync', email?, name?, avatar? } → full UserAccount
 *        (creates the Neon users/{uid} row on first login, applies
 *        daily/30-day usage resets, logs the login event)
 * POST { action: 'save', history, deletedIds? } — merge cloud+local history
 * POST { action: 'memory', memory }             — replace memory (≤2000)
 * POST { action: 'profile', name?, phone? }     — patch profile
 * POST { action: 'usage-get' }                  — { text, images, videos }
 * POST { action: 'usage-incr', type }           — increment a counter
 *
 * Every call carries the caller's Orin session Bearer token (HS256) or a
 * Neon Auth JWT. No Firebase, no Clerk.
 */
import { requireUser, httpError } from './_lib/auth.js';
import { sadd, sdocGet, sdocSet, TS } from './_lib/store.js';
import { apiHandler } from './_lib/http.js';

export const config = { maxDuration: 30 };

const MEMORY_MAX = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

const hasUserMessage = (c) =>
  Array.isArray(c?.messages) && c.messages.some((m) => m?.role === 'user');

function normalizeHistory(raw) {
  if (typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed;
}

function tierFor(plan) {
  const p = String(plan || 'free').toLowerCase();
  if (p === 'pro' || p === 'pro_yearly' || p === 'elite') return 'Pro (BYO-Google)';
  if (p === 'basic' || p === 'basic_yearly') return 'Basic';
  return 'Free';
}

async function handler(req, res) {
  const { uid, email: tokenEmail } = await requireUser(req);

  // ── GET: history + memory ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const snap = await sdocGet('users', uid);
    const data = snap.exists ? (snap.data() || {}) : {};
    return res.status(200).json({
      history: normalizeHistory(data.historyBlob),
      memory: typeof data.memory === 'string' ? data.memory : '',
    });
  }

  if (req.method !== 'POST') throw httpError(405, 'GET/POST only');
  const { action } = req.body || {};

  // ── SYNC: resolve session → UserAccount ──────────────────────────────────
  if (action === 'sync') {
    const body = req.body || {};
    const email = String(body.email || tokenEmail || '');
    const name = String(body.name || '');
    const avatar = body.avatar != null ? String(body.avatar) : null;

    try {
      const today = new Date().toISOString().split('T')[0];
      await sadd('login_events', { uid, email: email || null, loginAt: TS(), date: today });
    } catch {}

    const snap = await sdocGet('users', uid);
    let userData;
    if (!snap.exists) {
      userData = {
        ...(email ? { email } : {}),
        name: name || (email ? email.split('@')[0] : 'Orin User'),
        avatar: avatar || null,
        plan: 'free',
        role: 'visitor',
        approved: false,
        subscriptionStatus: 'active',
        tokenVersion: 0,
        createdAt: TS(),
        lastUpdated: TS(),
        usage: { text: 0, images: 0, videos: 0, mediaWindowStart: Date.now() },
        memory: 'User is new to Orin AI.',
        lastReset: Date.now(),
      };
      await sdocSet('users', uid, userData);
    } else {
      userData = snap.data() || {};
      const updates = {};
      if (avatar && userData.avatar !== avatar) updates.avatar = avatar;
      if (email && !userData.email) updates.email = email;
      if (name && !userData.name) updates.name = name;

      const now = Date.now();
      const usage = userData.usage ?? { text: 0, images: 0, videos: 0 };
      let lastReset = userData.lastReset || 0;
      let mediaWindowStart = usage.mediaWindowStart || lastReset || now;
      let changed = false;
      if (!lastReset || now - lastReset > DAY_MS) {
        usage.text = 0;
        lastReset = now;
        changed = true;
      }
      if (!mediaWindowStart || now - mediaWindowStart > THIRTY_DAYS_MS) {
        usage.images = 0;
        usage.videos = 0;
        mediaWindowStart = now;
        changed = true;
      }
      if (changed) {
        usage.mediaWindowStart = mediaWindowStart;
        updates.usage = usage;
        updates.lastReset = lastReset;
      }
      if (Object.keys(updates).length > 0) {
        updates.lastUpdated = TS();
        await sdocSet('users', uid, updates, true);
        userData = { ...userData, ...updates };
      }
    }

    const plan = userData.plan || 'free';
    return res.status(200).json({
      id: uid,
      name: userData.name || (email ? email.split('@')[0] : 'Orin User'),
      email: userData.email || email || '',
      phone: userData.phone || undefined,
      avatar: userData.avatar ?? null,
      tier: tierFor(plan),
      plan,
      role: userData.role || 'visitor',
      approved: userData.approved || false,
      dailyUsage: userData.usage || { text: 0, images: 0, videos: 0 },
      ...(userData.theme ? { theme: userData.theme } : {}),
    });
  }

  // ── SAVE: merge cloud + local, persist ───────────────────────────────────
  if (action === 'save') {
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const deletedIds = new Set(Array.isArray(req.body.deletedIds) ? req.body.deletedIds : []);
    const snap = await sdocGet('users', uid);
    const cloud = normalizeHistory(snap.exists ? snap.data()?.historyBlob : null) || [];
    const cloudList = cloud.filter(hasUserMessage);
    const localList = history.filter(hasUserMessage);
    const byId = new Map(localList.map((c) => [c.id, c]));
    for (const c of cloudList) {
      const existing = byId.get(c.id);
      if (!existing) {
        byId.set(c.id, c);
        continue;
      }
      const cMsg = (c.messages || []).length;
      const eMsg = (existing.messages || []).length;
      const cTime = new Date(c.timestamp).getTime() || 0;
      const eTime = new Date(existing.timestamp).getTime() || 0;
      if (cMsg > eMsg || (cMsg === eMsg && cTime > eTime)) byId.set(c.id, c);
    }
    const merged = [...byId.values()]
      .filter((c) => !deletedIds.has(c.id))
      .sort((a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0));
    await sdocSet('users', uid, { historyBlob: JSON.stringify(merged), lastUpdated: TS() }, true);
    return res.status(200).json({ ok: true, count: merged.length });
  }

  // ── MEMORY ───────────────────────────────────────────────────────────────
  if (action === 'memory') {
    const memory = String(req.body.memory ?? '').slice(0, MEMORY_MAX);
    await sdocSet('users', uid, { memory, lastUpdated: TS() }, true);
    return res.status(200).json({ ok: true });
  }

  // ── PROFILE ──────────────────────────────────────────────────────────────
  if (action === 'profile') {
    const patch = { lastUpdated: TS() };
    if (typeof req.body.name === 'string' && req.body.name.trim().length >= 2) {
      patch.name = req.body.name.trim().slice(0, 60);
    }
    if (typeof req.body.phone === 'string') {
      const digits = req.body.phone.replace(/[\s()\-.]/g, '');
      if (digits && !/^\+?\d{9,15}$/.test(digits)) throw httpError(400, 'Enter a valid phone number.');
      if (digits) patch.phone = digits.startsWith('0') ? '+94' + digits.slice(1) : digits;
    }
    await sdocSet('users', uid, patch, true);
    return res.status(200).json({ ok: true });
  }

  // ── USAGE ────────────────────────────────────────────────────────────────
  if (action === 'usage-get') {
    const snap = await sdocGet('users', uid);
    const u = snap.exists ? (snap.data()?.usage ?? {}) : {};
    return res.status(200).json({ text: u.text ?? 0, images: u.images ?? 0, videos: u.videos ?? 0 });
  }

  if (action === 'usage-incr') {
    const type = req.body.type === 'images' || req.body.type === 'videos' ? req.body.type : 'text';
    const snap = await sdocGet('users', uid);
    const data = snap.exists ? (snap.data() || {}) : {};
    const now = Date.now();
    const usage = data.usage ?? { text: 0, images: 0, videos: 0 };
    let lastReset = data.lastReset || 0;
    let mediaWindowStart = usage.mediaWindowStart || lastReset || now;
    if (!lastReset || now - lastReset > DAY_MS) {
      usage.text = 0;
      lastReset = now;
    }
    if (!mediaWindowStart || now - mediaWindowStart > THIRTY_DAYS_MS) {
      usage.images = 0;
      usage.videos = 0;
      mediaWindowStart = now;
    }
    usage[type] = (usage[type] ?? 0) + 1;
    usage.mediaWindowStart = mediaWindowStart;
    await sdocSet('users', uid, { usage, lastReset, lastUpdated: TS() }, true);
    return res.status(200).json({ ok: true });
  }

  throw httpError(400, 'Unknown action');
}

export default apiHandler(handler);
