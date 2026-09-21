/**
 * POST /api/admin — admin & onboarding operations (replaces Firebase Cloud Functions).
 * One backend, one deployment: this is now the ONLY place these exist.
 *
 * body: { action: 'create-pending-signup' | 'approve-user' | 'generate-api-key' | 'ocr-process', ... }
 *
 * Roles come from custom claims on the caller's Firebase ID token
 * (visitor | training | devops | owner), set by approve-user.
 *   create-pending-signup : any authenticated user (App Check not available on Vercel;
 *                           abuse is bounded by rate limiting)
 *   approve-user          : owner only
 *   generate-api-key      : devops or owner
 *   ocr-process           : training, devops, or owner (mocked until Tesseract ships)
 *
 * Env: FIREBASE_SERVICE_ACCOUNT, ORIN_SECRET_CODE (optional signup bypass code).
 */
import crypto from 'crypto';
import { initAdmin, requireUser, httpError } from './_lib/firebase.js';
import { sadd, sdocSet, TS } from './_lib/store.js';
import { apiHandler } from './_lib/http.js';
import { rateLimit } from './_lib/ratelimit.js';

export const config = { maxDuration: 60 };

const VALID_ROLES = ['visitor', 'training', 'devops', 'owner'];

function logAudit(action, actorUid, details) {
  return sadd('audit_logs', {
    action, actorUid, details, timestamp: TS(),
  }).catch(() => {}); // audit must never break the request
}

function hasRole(decoded, ...roles) {
  return roles.includes(decoded.role);
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const decoded = await requireUser(req);
  const uid = decoded.uid;
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
    if (!hasRole(decoded, 'owner')) throw httpError(403, 'Owner access required.');
    const { targetUid, role, approved } = req.body || {};
    if (!targetUid || !VALID_ROLES.includes(role)) throw httpError(400, 'targetUid and valid role required');

    // 1. Custom claims are the real security boundary
    await initAdmin().auth().setCustomUserClaims(targetUid, { role });
    // 2. Profile doc for UI display
    await sdocSet('users', targetUid, {
      role, approved: !!approved, updatedAt: TS(),
    }, true);
    // 3. Update their request row (if any)
    await sdocSet('pending_signups', targetUid,
      { status: approved ? 'approved' : 'rejected', decidedAt: TS() }, true);

    await logAudit('APPROVE_USER', uid, { targetUid, role, approved });
    return res.status(200).json({ success: true });
  }

  // ── API key generation (devops/owner) ──────────────────────────────────────
  if (action === 'generate-api-key') {
    if (!hasRole(decoded, 'devops', 'owner')) throw httpError(403, 'DevOps role required.');
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
    if (!hasRole(decoded, 'training', 'devops', 'owner')) throw httpError(403, 'Training role required.');
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

  throw httpError(400, 'Unknown action');
}

export default apiHandler(handler);
