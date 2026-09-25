import crypto from 'node:crypto';
import { mintSession, httpError } from './auth.js';
import { sdocGet, sdocSet, sdocDelete, TS } from './store.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { normalizeIdentifier, identifierKey, passwordPolicyError, namePolicyError } from './identity.js';
import { rateLimit } from './ratelimit.js';
import { apiHandler } from './http.js';

async function profile(uid) {
  const snap = await sdocGet('users', uid);
  return snap.exists ? snap.data() || {} : {};
}

async function tokenVersion(uid) {
  return Number((await profile(uid)).tokenVersion || 0);
}

async function issue(uid, email) {
  return mintSession(uid, { email: email || '', tv: await tokenVersion(uid) });
}

function ip(req) {
  return String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const body = req.body || {};
  if (body.action === 'register') {
    if (!(await rateLimit(`register:${ip(req)}`, 10, 3_600_000))) throw httpError(429, 'Too many signup attempts.');
    const nameError = namePolicyError(body.name);
    const passwordError = passwordPolicyError(body.password);
    if (nameError || passwordError) throw httpError(400, nameError || passwordError);
    const email = normalizeIdentifier(body.email);
    const phone = normalizeIdentifier(body.phone);
    if (!email || email.type !== 'email') throw httpError(400, 'A valid email is required.');
    if (!phone || phone.type !== 'phone') throw httpError(400, 'A valid phone is required.');
    const key = identifierKey(email);
    if ((await sdocGet('auth_identifiers', key)).exists) throw httpError(409, 'An account with this email already exists.');
    const uid = `pw_${crypto.randomBytes(12).toString('hex')}`;
    try {
      await sdocSet('password_credentials', uid, { hash: hashPassword(body.password), email: email.value, phone: phone.value, createdAt: TS() });
      await sdocSet('auth_identifiers', key, { uid, type: 'email', createdAt: TS() });
      await sdocSet('auth_identifiers', identifierKey(phone), { uid, type: 'phone', createdAt: TS() });
      await sdocSet('users', uid, { name: String(body.name).trim(), email: email.value, phone: phone.value, plan: 'free', role: 'visitor', tokenVersion: 0, usage: { text: 0, images: 0, videos: 0 }, createdAt: TS(), lastUpdated: TS() });
      return res.status(200).json({ sessionToken: await issue(uid, email.value), user: { id: uid, name: String(body.name).trim(), email: email.value, phone: phone.value } });
    } catch (error) {
      await sdocDelete('password_credentials', uid).catch(() => {});
      await sdocDelete('auth_identifiers', key).catch(() => {});
      await sdocDelete('auth_identifiers', identifierKey(phone)).catch(() => {});
      await sdocDelete('users', uid).catch(() => {});
      throw error;
    }
  }
  if (body.action === 'login') {
    if (!(await rateLimit(`login:${ip(req)}`, 30, 3_600_000))) throw httpError(429, 'Too many login attempts.');
    const identifier = normalizeIdentifier(body.identifier);
    if (!identifier || typeof body.password !== 'string') throw httpError(400, 'Identifier and password are required.');
    const lookup = await sdocGet('auth_identifiers', identifierKey(identifier));
    if (!lookup.exists) throw httpError(401, 'Invalid credentials');
    const uid = String(lookup.data().uid);
    const credential = await sdocGet('password_credentials', uid);
    if (!credential.exists || !verifyPassword(body.password, credential.data().hash)) throw httpError(401, 'Invalid credentials');
    const data = await profile(uid);
    return res.status(200).json({ sessionToken: await issue(uid, data.email || credential.data().email || ''), user: { id: uid, name: data.name || '', email: data.email || '', phone: data.phone || '' } });
  }
  throw httpError(501, 'This legacy password operation is not available on the secure platform path.');
}

export default apiHandler(handler);
