/**
 * POST /api/auth/password — Orin AI first-party accounts (the ONLY sign-in method).
 *
 * body: { action: 'register' | 'login' | 'set-password' | 'reset-verify' | 'reset-confirm', ... }
 *   register:      { name, email, phone, password, confirmPassword }
 *                  (legacy {name, identifier, password} still accepted)
 *   login:         { identifier, password }  — identifier = email OR phone
 *   set-password:  {} + Bearer auth          — adds a password to an existing account
 *   reset-verify:  { name, email, phone }    — ALL must match → short-lived reset token
 *   reset-confirm: { resetToken, password, confirmPassword } → new password + session revocation
 *
 * Returns {customToken} for register/login — client signs in via signInWithCustomToken
 * so every existing Firebase-ID-token endpoint/rule works unchanged.
 *
 * Design notes:
 * - Passwords hashed with scrypt (_lib/passwords.js); hashes + identifier lookups live in
 *   password_credentials / auth_identifiers / password_resets — all denied to clients by rules.
 * - Auth users get a random unusable Firebase password: ALL checks happen HERE behind rate limits.
 * - Reset tokens are ≥256-bit random, stored SHA-256-hashed, single-use, 15-minute TTL;
 *   confirming a reset revokes all existing sessions (revokeRefreshTokens).
 */
import crypto from 'crypto';
import { initAdmin, requireUser, httpError } from '../_lib/firebase.js';
import { sdocGet, sdocSet, sdocUpdate, sdocDelete, squery, TS } from '../_lib/store.js';
import { apiHandler } from '../_lib/http.js';
import { hashPassword, verifyPassword } from '../_lib/passwords.js';
import { normalizeIdentifier, identifierKey, passwordPolicyError, namePolicyError } from '../_lib/identity.js';
import { rateLimit } from '../_lib/ratelimit.js';

export const config = { maxDuration: 30 };

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_ATTEMPTS_LIMIT = 10;
const IP_WINDOW_MS = 60 * 60_000;
const IP_ATTEMPTS_LIMIT = 30;
const RESET_TOKEN_TTL_MS = 15 * 60_000;

function clientIp(req) {
  return ((req.headers['x-forwarded-for'] || '').split(',')[0]).trim() || 'unknown';
}

function sha256hex(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

/** Creates users/{uid} profile doc if missing (mirrors syncUserSession defaults). */
async function ensureProfile(uid, { name, email, phone }) {
  await sdocSet('users', uid, {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    lastUpdated: TS(),
  }, true);
}

async function issueCustomToken(uid) {
  return initAdmin().auth().createCustomToken(uid);
}

async function hasPasswordCredential(uid) {
  return (await sdocGet('password_credentials', String(uid))).exists;
}

/** Throws if either identifier is already claimed by another account. */
async function assertIdentifiersFree(emailNorm, phoneNorm) {
  const keys = [];
  if (emailNorm) keys.push({ key: identifierKey(emailNorm), label: 'email' });
  if (phoneNorm) keys.push({ key: identifierKey(phoneNorm), label: 'phone number' });
  const snaps = await Promise.all(keys.map(k => sdocGet('auth_identifiers', k.key)));
  for (let i = 0; i < snaps.length; i++) {
    if (!snaps[i].exists) continue;
    const claimedUid = snaps[i].data().uid;
    let googleOnly = false;
    try {
      const fbUser = await initAdmin().auth().getUser(claimedUid);
      googleOnly = !!fbUser.email && !(await hasPasswordCredential(claimedUid));
    } catch { /* record points at a vanished user */ }
    if (googleOnly) {
      throw httpError(409, 'An Orin account with this ' + keys[i].label +
        ' already exists via Google sign-in. Sign in with Google once, then add a password in Account Settings.');
    }
    throw httpError(409, 'An account with this ' + keys[i].label + ' already exists.');
  }
}

/** Creates both lookup docs; caller has already verified they're free. */
async function writeLookups(emailNorm, phoneNorm, uid) {
  if (emailNorm) {
    await sdocSet('auth_identifiers', identifierKey(emailNorm),
      { uid, type: 'email', createdAt: TS() });
  }
  if (phoneNorm) {
    await sdocSet('auth_identifiers', identifierKey(phoneNorm),
      { uid, type: 'phone', createdAt: TS() });
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const { action } = req.body || {};

  // ── REGISTER ─────────────────────────────────────────────────────────────
  if (action === 'register') {
    if (!(await rateLimit('auth-register:' + clientIp(req), 10, 60 * 60_000)))
      throw httpError(429, 'Too many signup attempts. Try again later.');

    const b = req.body || {};
    // Legacy shape {identifier} maps onto the new explicit fields.
    const emailRaw = b.email ?? (b.identifier && String(b.identifier).includes('@') ? b.identifier : undefined);
    const phoneRaw = b.phone ?? (b.identifier && !String(b.identifier).includes('@') ? b.identifier : undefined);

    const nameErr = namePolicyError(b.name);
    if (nameErr) throw httpError(400, nameErr);

    const emailNorm = emailRaw ? normalizeIdentifier(emailRaw) : null;
    if (emailRaw && (!emailNorm || emailNorm.type !== 'email')) throw httpError(400, 'Enter a valid email address.');
    const phoneNorm = phoneRaw ? normalizeIdentifier(phoneRaw) : null;
    if (phoneRaw && (!phoneNorm || phoneNorm.type !== 'phone')) throw httpError(400, 'Enter a valid phone number.');
    if (!emailNorm && !phoneNorm) throw httpError(400, 'Email is required.');
    if (!phoneNorm) throw httpError(400, 'Phone number is required.');

    const pwErr = passwordPolicyError(b.password);
    if (pwErr) throw httpError(400, pwErr);
    if (typeof b.confirmPassword === 'string' && b.confirmPassword !== b.password)
      throw httpError(400, 'Passwords do not match.');

    await assertIdentifiersFree(
      emailNorm ? { type: 'email', value: emailNorm.value } : null,
      phoneNorm
    );

    // Create the Firebase Auth user (random unusable password — logins come through here).
    let fbUser;
    try {
      fbUser = await initAdmin().auth().createUser({
        ...(emailNorm ? { email: emailNorm.value, emailVerified: false } : {}),
        password: crypto.randomBytes(32).toString('hex'),
        displayName: String(b.name).trim(),
      });
    } catch (e) {
      if (String(e?.code || '').includes('email-already-exists')) {
        throw httpError(409, 'An account with this email already exists.');
      }
      throw e;
    }

    try {
      const uid = fbUser.uid;
      await sdocSet('password_credentials', uid, {
        hash: hashPassword(b.password),
        identifierType: 'email',
        email: emailNorm ? emailNorm.value : null,
        phone: phoneNorm ? phoneNorm.value : null,
        createdAt: TS(),
        updatedAt: TS(),
      });
      await writeLookups(emailNorm, phoneNorm, uid);
      await ensureProfile(uid, {
        name: String(b.name).trim(),
        email: emailNorm ? emailNorm.value : null,
        phone: phoneNorm ? phoneNorm.value : null,
      });

      const customToken = await issueCustomToken(uid);
      return res.status(200).json({
        customToken,
        user: {
          id: uid,
          name: String(b.name).trim(),
          email: emailNorm ? emailNorm.value : '',
          phone: phoneNorm ? phoneNorm.value : '',
        },
      });
    } catch (e) {
      try { await initAdmin().auth().deleteUser(fbUser.uid); } catch {}
      throw e;
    }
  }

  // ── LOGIN ────────────────────────────────────────────────────────────────
  if (action === 'login') {
    const ip = clientIp(req);
    if (!(await rateLimit('auth-login-ip:' + ip, IP_ATTEMPTS_LIMIT, IP_WINDOW_MS)))
      throw httpError(429, 'Too many attempts from this network. Try again later.');

    const { identifier, password } = req.body || {};
    const norm = normalizeIdentifier(identifier);
    if (!norm || typeof password !== 'string') throw httpError(400, 'Email/phone and password are required.');

    if (!(await rateLimit('auth-login-id:' + identifierKey(norm), LOGIN_ATTEMPTS_LIMIT, LOGIN_WINDOW_MS)))
      throw httpError(429, 'Too many failed attempts. Try again in 15 minutes.');

    const lookupSnap = await sdocGet('auth_identifiers', identifierKey(norm));
    if (!lookupSnap.exists) throw httpError(401, 'Invalid credentials');
    const uid = lookupSnap.data().uid;

    const credSnap = await sdocGet('password_credentials', String(uid));
    if (!credSnap.exists || !verifyPassword(password, credSnap.data().hash)) {
      throw httpError(401, 'Invalid credentials');
    }

    const profileSnap = await sdocGet('users', String(uid));
    const p = profileSnap.data() || {};
    const customToken = await issueCustomToken(String(uid));
    return res.status(200).json({
      customToken,
      user: {
        id: uid,
        name: p.name || '',
        email: p.email || credSnap.data().email || '',
        phone: p.phone || credSnap.data().phone || '',
      },
    });
  }

  // ── SET-PASSWORD (authenticated; adds a password to an existing account) ──
  if (action === 'set-password') {
    const decoded = await requireUser(req);
    const uid = decoded.uid;
    const { password } = req.body || {};
    const pwErr = passwordPolicyError(password);
    if (pwErr) throw httpError(400, pwErr);

    const email = decoded.email ? decoded.email.toLowerCase() : null;
    if (email) {
      const claimSnap = await sdocGet('auth_identifiers', 'email:' + email);
      if (claimSnap.exists && claimSnap.data().uid !== uid) {
        throw httpError(409, "This email is already used for another Orin account's sign-in.");
      }
    }

    const existing = await sdocGet('password_credentials', uid);
    await sdocSet('password_credentials', uid, {
      hash: hashPassword(password),
      identifierType: email ? 'email' : 'unknown',
      email,
      ...(existing.exists ? {} : { createdAt: TS() }),
      updatedAt: TS(),
    }, true);
    if (email) {
      await sdocSet('auth_identifiers', 'email:' + email,
        { uid, type: 'email', createdAt: existing.exists ? existing.data().createdAt ?? TS() : TS() });
    }
    return res.status(200).json({ ok: true });
  }

  // ── RESET-VERIFY (knowledge check: name + email + phone must ALL match) ───
  if (action === 'reset-verify') {
    const ip = clientIp(req);
    if (!(await rateLimit('reset-ip:' + ip, 5, 15 * 60_000)))
      throw httpError(429, 'Too many reset attempts. Try again later.');

    const { name, email, phone } = req.body || {};
    const emailNorm = normalizeIdentifier(email);
    const phoneNorm = normalizeIdentifier(phone);
    const nameStr = String(name ?? '').trim();
    if (!nameStr || !emailNorm || !phoneNorm) throw httpError(400, 'Name, email, and phone number are required.');
    if (!(await rateLimit('reset-id:' + identifierKey(emailNorm), 5, 60 * 60_000)))
      throw httpError(429, 'Too many reset attempts for this account. Try again later.');

    const GENERIC = 'The details do not match our records.';
    const lookupSnap = await sdocGet('auth_identifiers', identifierKey(emailNorm));
    if (!lookupSnap.exists) throw httpError(401, GENERIC);
    const uid = String(lookupSnap.data().uid);

    const [profileSnap, credSnap] = await Promise.all([
      sdocGet('users', uid),
      sdocGet('password_credentials', uid),
    ]);
    const profile = profileSnap.data() || {};
    const cred = credSnap.exists ? credSnap.data() : {};

    const storedPhone = normPhone(profile.phone || cred.phone || '');
    const providedPhone = normPhone(phoneNorm.value);
    const nameOk = safeEqualText(nameStr.toLowerCase(), String(profile.name || '').toLowerCase());
    const phoneOk = safeEqualText(providedPhone, storedPhone);
    const emailOk = safeEqualText(emailNorm.value, String(profile.email || cred.email || '').toLowerCase());
    if (!credSnap.exists || !nameOk || !phoneOk || !emailOk) throw httpError(401, GENERIC);

    // Issue a single-use token; store only its hash.
    const resetToken = crypto.randomBytes(32).toString('hex');
    await sdocSet('password_resets', sha256hex(resetToken), {
      uid,
      used: false,
      createdAt: TS(),
      expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
    });
    return res.status(200).json({ resetToken, expiresIn: RESET_TOKEN_TTL_MS / 1000 });
  }

  // ── RESET-CONFIRM (consume token, set new password, kill sessions) ────────
  if (action === 'reset-confirm') {
    if (!(await rateLimit('reset-confirm:' + clientIp(req), 10, 60 * 60_000)))
      throw httpError(429, 'Too many attempts. Try again later.');
    const { resetToken, password, confirmPassword } = req.body || {};
    if (!resetToken || typeof resetToken !== 'string' || resetToken.length < 32)
      throw httpError(400, 'Invalid or expired reset request.');
    const pwErr = passwordPolicyError(password);
    if (pwErr) throw httpError(400, pwErr);
    if (typeof confirmPassword === 'string' && confirmPassword !== password)
      throw httpError(400, 'Passwords do not match.');

    const ref = { collection: 'password_resets', id: sha256hex(resetToken) };
    let uid = null;
    {
      // Single-use consume: validate first, then flip. The token is 256-bit
      // random, so a double-submit race can only repeat the same outcome.
      const snap = await sdocGet(ref.collection, ref.id);
      if (!snap.exists) throw httpError(410, 'Reset request expired or unknown. Start again.');
      const d = snap.data();
      if (d.used) throw httpError(410, 'This reset link was already used. Start again.');
      if (Number(d.expiresAt) < Date.now()) throw httpError(410, 'Reset request expired. Start again.');
      uid = String(d.uid);
      await sdocUpdate(ref.collection, ref.id, { used: true, usedAt: TS() });
    }

    // New hash + invalidate every existing session for this user.
    await sdocSet('password_credentials', uid,
      { hash: hashPassword(password), updatedAt: TS() }, true);
    await initAdmin().auth().revokeRefreshTokens(uid);

    // Consume any other outstanding reset tokens for this uid.
    const others = await squery('password_resets', [{ field: 'uid', value: uid }]);
    for (const doc of others) {
      if (doc.id !== sha256hex(resetToken)) await sdocDelete('password_resets', doc.id);
    }

    return res.status(200).json({ ok: true });
  }

  throw httpError(400, 'Unknown action. Use register, login, set-password, reset-verify, or reset-confirm.');
}

function normPhone(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/** Length-safe constant-time text compare. */
function safeEqualText(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // flatten timing on length mismatch
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

export default apiHandler(handler);
