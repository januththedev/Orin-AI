/**
 * POST /api/admin — admin & onboarding operations. One backend, one deployment:
 * this is now the ONLY place these exist.
 *
 * body: { action, ... }
 *   create-pending-signup : any authenticated user (abuse bounded by rate limiting)
 *   approve-user          : owner only
 *   generate-api-key      : devops or owner
 *   ocr-process           : training, devops, or owner (mocked until Tesseract ships)
 *   list-pending          : owner only (replaces direct Firestore reads)
 *   list-keys             : devops or owner (hashes never leave the server)
 *   metrics               : devops or owner
 *
 * Roles live on the caller's Neon users/{uid} row (visitor | training |
 * devops | owner), set by approve-user. No Firebase, no custom claims.
 *
 * Env: ORIN_SECRET_CODE (optional signup bypass code).
 */
import crypto from 'crypto';
import { requireUser, httpError } from './_lib/auth.js';
import { sadd, sdocGet, sdocSet, squery, slist, TS } from './_lib/store.js';
import { apiHandler } from './_lib/http.js';
import { rateLimit } from './_lib/ratelimit.js';

export const config = { maxDuration: 60 };

const VALID_ROLES = ['visitor', 'training', 'devops', 'owner'];

function logAudit(action, actorUid, details) {
  return sadd('audit_logs', {
    action, actorUid, details, timestamp: TS(),
  }).catch(() => {}); // audit must never break the request
}

function hasRole(role, ...roles) {
  return roles.includes(role);
}

/** The caller's role, from their Neon profile row (defaults to visitor). */
async function callerRole(uid) {
  try {
    const snap = await sdocGet('users', String(uid));
    const r = snap.exists ? String(snap.data()?.role || 'visitor') : 'visitor';
    return VALID_ROLES.includes(r) ? r : 'visitor';
  } catch {
    return 'visitor';
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const decoded = await requireUser(req);
  const uid = decoded.uid;
  const role = await callerRole(uid);
  const { action } = req.body || {};

  // ── Signup request (any signed-in user) ────────────────────────────────────
  if (action === 'create-pending-signup') {
    if (!(await rateLimit(`signup-req:${uid}`, 5, 24 * 3600_000)))
      throw httpError(429, 'Too many signup requests. Try again tomorrow.');
    const { email, reason } = req.body || {};
    if (!email) throw httpError(400, 'email required');
    const secretCode = process.env.ORIN_SECRET_CODE || '';
    const codeDetected = !!secretCode && String(reason || '').includes(secretCode);

    await sdocSet('pending_signups', uid, {
      uid,
      email,
      reason: String(reason || '').slice(0, 2000),
      codeDetected,
      requestedRole: codeDetected ? 'devops' : 'visitor',
      status: 'pending',
      createdAt: TS(),
    });
    await logAudit('SIGNUP_REQUEST', uid, { email, codeDetected });
    return res.status(200).json({ success: true });
  }

  // ── Approve user + set role (owner only) ─────────────────────────────────────
  if (action === 'approve-user') {
    if (!hasRole(role, 'owner')) throw httpError(403, 'Owner access required.');
    const { targetUid, role: newRole, approved } = req.body || {};
    if (!targetUid || !VALID_ROLES.includes(newRole)) throw httpError(400, 'targetUid and valid role required');

    // The users row IS the security boundary now (requireUser reads it per call).
    await sdocSet('users', String(targetUid), {
      role: newRole, approved: !!approved, updatedAt: TS(),
    }, true);
    // Update their request row (if any)
    await sdocSet('pending_signups', String(targetUid),
      { status: approved ? 'approved' : 'rejected', decidedAt: TS() }, true);

    await logAudit('APPROVE_USER', uid, { targetUid, role: newRole, approved });
    return res.status(200).json({ success: true });
  }

  // ── API key generation (devops/owner) ──────────────────────────────────────
  if (action === 'generate-api-key') {
    if (!hasRole(role, 'devops', 'owner')) throw httpError(403, 'DevOps role required.');
    const note = String(req.body?.note || 'Generated Key').slice(0, 100);
    const rawKey = 'orin_' + crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    await sadd('api_keys', {
      hash, note, createdBy: uid, enabled: true, createdAt: TS(),
    });
    await logAudit('GENERATE_KEY', uid, { note });
    // Raw key shown exactly once.
    return res.status(200).json({ apiKey: rawKey });
  }

  // ── OCR (training/devops/owner; mocked until Tesseract is deployed) ─────────
  if (action === 'ocr-process') {
    if (!hasRole(role, 'training', 'devops', 'owner')) throw httpError(403, 'Training role required.');
    const { imageUrl, lang = 'en' } = req.body || {};
    if (!imageUrl) throw httpError(400, 'imageUrl required');
    await logAudit('OCR_PROCESS', uid, { imageUrl, lang });
    // Placeholder output — wire Tesseract here when function memory allows.
    return res.status(200).json({
      rawText: '1. What is the derivative of sin(x)?\n   (i) cos(x)  (ii) -cos(x)\n\n2. Define "Momentum".\n',
      blocks: [
        { id: 1, text: 'What is the derivative of sin(x)?', prob: 0.98 },
        { id: 2, text: 'Define "Momentum".', prob: 0.95 },
      ],
    });
  }

  // ── Pending signup requests (owner only) ───────────────────────────────────
  if (action === 'list-pending') {
    if (!hasRole(role, 'owner')) throw httpError(403, 'Owner access required.');
    const docs = await squery('pending_signups', [{ field: 'status', value: 'pending' }], { limit: 100 });
    return res.status(200).json({
      requests: docs.map(d => ({ id: d.id, ...(d.data() || {}) })),
    });
  }

  // ── API keys (devops/owner; hashes never leave the server) ───────────────────
  if (action === 'list-keys') {
    if (!hasRole(role, 'devops', 'owner')) throw httpError(403, 'DevOps role required.');
    const docs = await slist('api_keys', { limit: 100 });
    return res.status(200).json({
      keys: docs.map(d => {
        const data = d.data() || {};
        return { id: d.id, note: data.note || '', createdBy: data.createdBy || '', enabled: data.enabled !== false, createdAt: data.createdAt || 0, hashPrefix: String(data.hash || '').slice(0, 12) };
      }),
    });
  }

  // ── Site metrics (devops/owner) ──────────────────────────────────────────────
  if (action === 'metrics') {
    if (!hasRole(role, 'devops', 'owner')) throw httpError(403, 'DevOps role required.');
    const snap = await sdocGet('site_metrics', 'meters');
    const data = snap.exists ? (snap.data() || {}) : {};
    return res.status(200).json({
      totalUsers: data.totalUsers || 0,
      activeToday: data.activeToday || 0,
      aiRequests: data.aiRequests || 0,
      serverStatus: data.serverStatus || 'online',
      lastBackup: data.lastBackup || Date.now(),
    });
  }

  throw httpError(400, 'Unknown action');
}

export default apiHandler(handler);
