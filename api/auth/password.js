/**
 * POST /api/auth/password — Orin AI first-party accounts (password sign-in).
 *
 * body: { action: 'register' | 'login' | 'set-password' | 'reset-verify' | 'reset-confirm', ... }
 *   register:      { name, email, phone, password, confirmPassword }
 *                  (legacy {name, identifier, password} still accepted)
 *   login:         { identifier, password }  — identifier = email OR phone
 *   set-password:  {} + Bearer auth          — adds a password to an existing account
 *   reset-verify:  { name, email, phone }    — ALL must match → short-lived reset token
 *   reset-confirm: { resetToken, password, confirmPassword } → new password + session revocation
 *
 * Returns {sessionToken, user} for register/login — the client stores the
 * Orin session token (HS256, 30 days) and sends it as the Bearer token.
 * Identity lives in Neon (users / password_credentials / auth_identifiers /
 * password_resets). No Firebase, no Clerk — nothing leaves this backend.
 *
 * Design notes:
 * - Passwords hashed with scrypt (_lib/passwords.js); hashes + identifier lookups live in
 *   password_credentials / auth_identifiers / password_resets in Neon.
 * - Reset tokens are ≥256-bit random, stored SHA-256-hashed, single-use, 15-minute TTL;
 *   confirming a reset bumps users/{uid}.tokenVersion (revokes all sessions).
 */
import crypto from 'crypto';
import { requireUser, mintSession, verifySessionPayload, httpError } from '../_lib/auth.js';
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

async function currentTokenVersion(uid) {
  try {
    const snap = await sdocGet('users', String(uid));
    return snap.exists ? (Number(snap.data()?.tokenVersion) || 0) : 0;
  } catch {
    return 0;
  }
}

async function issueSession(uid, email) {
  return mintSession(String(uid), { email: email || '', tv: await currentTokenVersion(uid) });
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
    throw httpError(409, 'An account with this ' + keys[i].label + ' already exists. Sign in instead.');
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

    // New Orin identity: uid + Neon rows (no external auth provider involved).
    const uid = 'pw_' + crypto.randomBytes(12).toString('hex');
    try {
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

      const sessionToken = await issueSession(uid, emailNorm ? emailNorm.value : '');
      return res.status(200).json({
        sessionToken,
        user: {
          id: uid,
          name: String(b.name).trim(),
          email: emailNorm ? emailNorm.value : '',
          phone: phoneNorm ? phoneNorm.value : '',
        },
      });
    } catch (e) {
      // Best-effort rollback of the half-created identity.
      try {
        await sdocDelete('password_credentials', uid);
        if (emailNorm) await sdocDelete('auth_identifiers', identifierKey(emailNorm));
        if (phoneNorm) await sdocDelete('auth_identifiers', identifierKey(phoneNorm));
        await sdocDelete('users', uid);
      } catch {}
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
    const sessionToken = await issueSession(String(uid), p.email || credSnap.data().email || '');
    return res.status(200).json({
      sessionToken,
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
    try {
      const usnap = await sdocGet('users', uid);
      const tv = usnap.exists ? (Number(usnap.data()?.tokenVersion) || 0) : 0;
      await sdocSet('users', uid, { tokenVersion: tv + 1, updatedAt: TS() }, true);
    } catch {}

    // Consume any other outstanding reset tokens for this uid.
    const others = await squery('password_resets', [{ field: 'uid', value: uid }]);
    for (const doc of others) {
      if (doc.id !== sha256hex(resetToken)) await sdocDelete('password_resets', doc.id);
    }

    // A password reset also kills external MCP tokens for this account.
    try {
      const mcps = await squery('mcp_credentials', [{ field: 'uid', value: uid }]);
      for (const doc of mcps) await sdocDelete('mcp_credentials', doc.id);
    } catch {}

    return res.status(200).json({ ok: true });
  }

  // ── MCP CREDENTIALS (Orin MCP tokens for external AI clients) ────────────
  // Dedicated long-lived, scope-limited session tokens. Shown ONCE at mint;
  // only sha256 hashes + metadata live in Neon. Revoke deletes the row, and
  // auth.js fails closed on the missing row — stolen tokens die on revoke.
  const MCP_SCOPES = ['models:read', 'chat:generate', 'usage:read'];

  // mcp-verify is PUBLIC (called by the MCP server per session start).
  if (action === 'mcp-verify') {
    const { token } = req.body || {};
    if (!(await rateLimit('mcp-verify:' + clientIp(req), 60, 60_000)))
      throw httpError(429, 'Slow down');
    let payload;
    try {
      payload = verifySessionPayload(String(token || ''));
    } catch {
      throw httpError(401, 'Invalid credential');
    }
    if (payload.iss !== 'orin' || payload.typ !== 'mcp' || !payload.jti) {
      throw httpError(401, 'Not an MCP credential');
    }
    const snap = await sdocGet('mcp_credentials', String(payload.jti));
    if (!snap.exists || String(snap.data()?.uid) !== String(payload.uid)) {
      throw httpError(401, 'Credential revoked');
    }
    const scopes = Array.isArray(payload.scopes) ? payload.scopes.filter((s) => MCP_SCOPES.includes(s)) : [];
    try {
      await sdocSet('mcp_credentials', String(payload.jti), { lastUsedAt: TS() }, true);
    } catch {}
    return res.status(200).json({ uid: String(payload.uid), scopes });
  }

  if (action === 'mcp-create') {
    const decoded = await requireUser(req);
    const uid = decoded.uid;
    const { name, scopes } = req.body || {};
    const cleanName = String(name || '').trim().slice(0, 60) || 'MCP token';
    const cleanScopes = Array.isArray(scopes) ? [...new Set(scopes.map(String))].filter((s) => MCP_SCOPES.includes(s)) : [];
    if (!cleanScopes.length) throw httpError(400, 'Pick at least one scope: ' + MCP_SCOPES.join(', '));
    if (!(await rateLimit('mcp-create:' + uid, 10, 60_000)))
      throw httpError(429, 'Too many tokens. Try again later.');
    const existing = await squery('mcp_credentials', [{ field: 'uid', value: uid }]);
    if (existing.length >= 10) throw httpError(409, 'Token limit reached (10). Revoke one first.');

    const jti = 'mcp_' + crypto.randomBytes(12).toString('hex');
    const token = mintSession(uid, { email: decoded.email || '', tv: await currentTokenVersion(uid), typ: 'mcp', jti, scopes: cleanScopes, expDays: 365 });
    await sdocSet('mcp_credentials', jti, {
      uid, name: cleanName, scopes: cleanScopes,
      prefix: token.slice(-12),
      hash: sha256hex(token),
      createdAt: TS(), lastUsedAt: 0,
    });
    return res.status(200).json({ token, id: jti, name: cleanName, scopes: cleanScopes });
  }

  if (action === 'mcp-list') {
    const decoded = await requireUser(req);
    const docs = await squery('mcp_credentials', [{ field: 'uid', value: decoded.uid }], { limit: 50 });
    return res.status(200).json({
      tokens: docs.map((d) => {
        const v = d.data() || {};
        return {
          id: d.id, name: v.name || '', scopes: v.scopes || [],
          prefix: v.prefix || '', createdAt: v.createdAt || 0, lastUsedAt: v.lastUsedAt || 0,
        };
      }),
    });
  }

  if (action === 'mcp-revoke') {
    const decoded = await requireUser(req);
    const { id } = req.body || {};
    if (!id || typeof id !== 'string') throw httpError(400, 'Token id required');
    const snap = await sdocGet('mcp_credentials', id);
    if (!snap.exists || String(snap.data()?.uid) !== String(decoded.uid)) {
      throw httpError(404, 'Token not found');
    }
    await sdocDelete('mcp_credentials', id);
    return res.status(200).json({ ok: true });
  }

  throw httpError(400, 'Unknown action. Use register, login, set-password, reset-verify, reset-confirm, mcp-create, mcp-list, mcp-revoke, or mcp-verify.');
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
