import { mintSession, sanitizeUid, httpError } from './auth.js';
import { sdocGet, sdocSet, TS } from './store.js';
import { verifyNeonToken } from './neonauth.js';
import { rateLimit } from './ratelimit.js';
import { apiHandler } from './http.js';

function profile(payload) {
  const email = payload.email || payload.primary_email || '';
  const name = payload.name || payload.display_name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || (email ? String(email).split('@')[0] : 'Orin user');
  return { email: String(email || ''), name, phone: String(payload.phone_number || payload.phone || ''), avatar: String(payload.picture || payload.image_url || '') };
}

async function handler(req, res) {
  if (req.method !== 'POST' || req.body?.action !== 'exchange') throw httpError(400, 'Neon exchange required.');
  if (!(await rateLimit(`neon:${String(req.headers?.['x-forwarded-for'] || '').split(',')[0]}`, 30, 60_000))) throw httpError(429, 'Too many attempts.');
  const payload = await verifyNeonToken(String(req.body?.token || ''));
  const uid = `n_${sanitizeUid(payload.sub)}`;
  const next = profile(payload);
  const existing = await sdocGet('users', uid);
  const previous = existing.exists ? existing.data() || {} : {};
  const data = { ...previous, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value)), authProvider: 'neon', neonSub: String(payload.sub), lastUpdated: TS() };
  await sdocSet('users', uid, data, true);
  await sdocSet('neon_links', String(payload.sub), { uid, createdAt: TS() });
  const sessionToken = mintSession(uid, { email: data.email || '', tv: Number(data.tokenVersion || 0) });
  return res.status(200).json({ sessionToken, user: { id: uid, name: data.name, email: data.email, phone: data.phone, avatar: data.avatar } });
}

export default apiHandler(handler);
