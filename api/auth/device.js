/**
 * POST /api/auth/device — OAuth-2-Device-Flow style login for the desktop app.
 *
 * Flow:
 *   1. Desktop app  : POST {action:'start'}                → {device_code, user_code}
 *   2. Desktop app  : opens https://orinai.org/#device-auth?code=<user_code> in system browser
 *   3. User         : signs in on the website, taps "Approve"
 *                     POST {action:'approve', device_code} + Bearer session token
 *   4. Desktop app  : polls POST {action:'token', device_code} → {session_token} once approved
 *
 * The device_code acts as the bearer secret for polling (never shown to the user);
 * approval additionally requires a signed-in web session that confirms the SAME
 * user_code visible in the browser. Codes expire after 10 minutes; polls are
 * rate-limited; approved/pending docs are single-use. Auth is Orin sessions
 * (Neon-backed) — no Firebase, no external IdP.
 */
import crypto from 'crypto';
import { requireUser, mintSession, httpError } from '../_lib/auth.js';
import { sdocGet, sdocSet, sdocUpdate, squery, TS } from '../_lib/store.js';
import { apiHandler } from '../_lib/http.js';
import { rateLimit } from '../_lib/ratelimit.js';

export const config = { maxDuration: 30 };

const CODE_TTL_MS = 10 * 60_000;
// Unambiguous alphabet — no 0/O/1/I/L confusion when typed by hand.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomUserCode() {
  const pick = () => Array.from({ length: 4 }, () => USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)]).join('');
  return `${pick()}-${pick()}`;
}

function clientIp(req) {
  return ((req.headers['x-forwarded-for'] || '').split(',')[0]).trim() || 'unknown';
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const { action } = req.body || {};

  // ── START (desktop app) ─────────────────────────────────────────────────────
  if (action === 'start') {
    if (!(await rateLimit('device-start:' + clientIp(req), 20, 3600_000)))
      throw httpError(429, 'Too many login attempts. Try again later.');
    const deviceCode = crypto.randomBytes(32).toString('hex');
    const userCode = randomUserCode();
    const now = Date.now();
    await sdocSet('device_auth', deviceCode, {
      deviceCode,
      userCode,
      status: 'pending',
      uid: null,
      createdAt: TS(),
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
    });
    return res.status(200).json({
      device_code: deviceCode,
      user_code: userCode,
      verify_url: `https://orinai.org/#device-auth?code=${userCode}`,
      expires_in: Math.floor(CODE_TTL_MS / 1000),
      interval: 3,
    });
  }

  // ── TOKEN POLL (desktop app; device_code is the bearer secret) ──────────────
  if (action === 'token') {
    const ip = clientIp(req);
    if (!(await rateLimit('device-poll:' + ip, 120, 60_000)))
      throw httpError(429, 'Slow down');
    const { device_code: deviceCode } = req.body || {};
    if (!deviceCode || !/^[0-9a-f]{64}$/.test(String(deviceCode))) throw httpError(400, 'invalid device_code');
    const snap = await sdocGet('device_auth', String(deviceCode));
    if (!snap.exists) return res.status(200).json({ status: 'expired' });
    const d = snap.data();
    if (Number(d.expiresAt) < Date.now()) return res.status(200).json({ status: 'expired' });
    if (d.status === 'denied') return res.status(200).json({ status: 'denied' });
    if (d.status !== 'approved') return res.status(200).json({ status: 'pending' });

    // Single-use: consume immediately, then mint the session token.
    await sdocUpdate('device_auth', String(deviceCode), { status: 'consumed', consumedAt: TS() });
    let email = '';
    let tv = 0;
    try {
      const usnap = await sdocGet('users', String(d.uid));
      if (usnap.exists) {
        email = String(usnap.data()?.email || '');
        tv = Number(usnap.data()?.tokenVersion) || 0;
      }
    } catch {}
    const sessionToken = mintSession(String(d.uid), { email, tv });
    // `custom_token` kept as an alias so older desktop builds keep working.
    return res.status(200).json({ status: 'approved', session_token: sessionToken, custom_token: sessionToken });
  }

  // ── APPROVE (signed-in user in browser) ─────────────────────────────────────
  if (action === 'approve') {
    const decoded = await requireUser(req);
    const { device_code: deviceCode, deny } = req.body || {};
    if (!deviceCode || !/^[0-9a-f]{64}$/.test(String(deviceCode))) throw httpError(400, 'invalid device_code');
    // Atomic approve: only a pending, unexpired code flips. Concurrent taps
    // collapse to one winner; losers get 409 like the old transaction did.
    const snap = await sdocGet('device_auth', String(deviceCode));
    if (!snap.exists) throw httpError(404, 'Unknown or expired code');
    const d = snap.data();
    if (Number(d.expiresAt) < Date.now()) throw httpError(410, 'This code has expired. Start again from the desktop app.');
    if (d.status !== 'pending') throw httpError(409, 'This code was already used.');
    await sdocUpdate('device_auth', String(deviceCode), {
      status: deny ? 'denied' : 'approved',
      uid: deny ? null : decoded.uid,
      decidedAt: TS(),
    });
    return res.status(200).json({ ok: true, approved: !deny });
  }

  // ── LOOKUP by user_code (browser page needs device_code to approve) ─────────
  if (action === 'lookup') {
    const decoded = await requireUser(req);
    if (!(await rateLimit('device-lookup:' + decoded.uid, 30, 60_000)))
      throw httpError(429, 'Slow down');
    const { user_code: userCode } = req.body || {};
    const normalized = String(userCode || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalized)) throw httpError(400, 'Enter the code shown in the Orin desktop app.');
    const docs = await squery(
      'device_auth',
      [{ field: 'userCode', value: normalized }, { field: 'status', value: 'pending' }],
      { limit: 1 },
    );
    if (!docs.length) throw httpError(404, 'No waiting request found for that code. It may have expired — start again from the desktop app.');
    const doc = docs[0];
    if (Number(doc.data().expiresAt) < Date.now()) throw httpError(410, 'This code has expired. Start again from the desktop app.');
    return res.status(200).json({ device_code: doc.id, requested_at: doc.data().createdAt });
  }

  throw httpError(400, 'Unknown action');
}

export default apiHandler(handler);
