/**
 * POST /api/auth/session — resolve the caller's Bearer session into the
 * full Orin UserAccount (the server-side half of the old client
 * syncUserSession). Creates the Neon users/{uid} row on first login,
 * applies daily/30-day usage-window resets, logs the login event.
 *
 * body: { action: 'sync', email?, name?, avatar? }  (+ Bearer session token)
 *   → UserAccount { id, name, email, phone, avatar, tier, plan, role,
 *                   approved, dailyUsage, theme? }
 */
import { requireUser, httpError } from '../_lib/auth.js';
import { sadd, sdocGet, sdocSet, TS } from '../_lib/store.js';
import { apiHandler } from '../_lib/http.js';

export const config = { maxDuration: 30 };

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

function tierFor(plan) {
  const p = String(plan || 'free').toLowerCase();
  if (p === 'pro' || p === 'pro_yearly' || p === 'elite') return 'Pro (BYO-Google)';
  if (p === 'basic' || p === 'basic_yearly') return 'Basic';
  return 'Free';
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const { action } = req.body || {};
  if (action !== 'sync') throw httpError(400, 'Unknown action');
  const { uid, email: tokenEmail } = await requireUser(req);
  const body = req.body || {};
  const email = String(body.email || tokenEmail || '');
  const name = String(body.name || '');
  const avatar = body.avatar != null ? String(body.avatar) : null;

  // Login event (best-effort, never blocks sign-in).
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

export default apiHandler(handler);
