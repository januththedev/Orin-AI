/**
 * POST /api/auth/neon — bridge Neon Auth sessions into Orin identity.
 *
 * The website (or any client) signs in with Neon Auth dashboard-side
 * (Google + any enabled method). This endpoint verifies the Neon access
 * token (Ed25519/JWKS), maps the Neon user to an Orin identity in Neon
 * (`n_<sub>`, auto-provisioned on first login), and returns an Orin
 * session token — so quotas, sync, device flow, and the PC app work on
 * one credential. No Firebase, no Clerk.
 *
 * body: { action: 'exchange', token }
 *   → { sessionToken, user: { id, name, email, phone } }
 */
import { mintSession, sanitizeUid, httpError } from '../_lib/auth.js';
import { sdocGet, sdocSet, TS } from '../_lib/store.js';
import { apiHandler } from '../_lib/http.js';
import { rateLimit } from '../_lib/ratelimit.js';
import { verifyNeonToken } from '../_lib/neonauth.js';

export const config = { maxDuration: 30 };

function clientIp(req) {
  return ((req.headers['x-forwarded-for'] || '').split(',')[0]).trim() || 'unknown';
}

function profileFrom(payload) {
  const email =
    payload.email || payload.primary_email || (Array.isArray(payload.emails) && payload.emails[0]) || '';
  const name =
    payload.name || payload.display_name ||
    [payload.given_name, payload.family_name].filter(Boolean).join(' ').trim() ||
    (email ? String(email).split('@')[0] : 'Orin user');
  const phone = payload.phone_number || payload.phone || '';
  const image = payload.picture || payload.image_url || payload.avatar_url || '';
  return { email: String(email || ''), name: String(name || 'Orin user'), phone: String(phone || ''), image: String(image || '') };
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const { action, token } = req.body || {};
  if (action !== 'exchange') throw httpError(400, 'Unknown action');
  if (!(await rateLimit('neon-exchange:' + clientIp(req), 30, 60_000))) {
    throw httpError(429, 'Too many attempts. Try again later.');
  }

  const payload = await verifyNeonToken(token);
  const profile = profileFrom(payload);
  const uid = 'n_' + sanitizeUid(payload.sub);

  const snap = await sdocGet('users', uid).catch(() => ({ exists: false, data: () => ({}) }));
  const prev = snap.exists ? (snap.data() || {}) : {};
  await sdocSet('users', uid, {
    ...(prev.name || profile.name ? { name: prev.name || profile.name } : {}),
    ...(profile.email && !prev.email ? { email: profile.email } : {}),
    ...(profile.phone && !prev.phone ? { phone: profile.phone } : {}),
    ...(profile.image && !prev.avatar ? { avatar: profile.image } : {}),
    authProvider: prev.authProvider || 'neon',
    neonSub: String(payload.sub),
    lastUpdated: TS(),
  }, true);
  await sdocSet('neon_links', String(payload.sub), { uid, createdAt: TS() }).catch(() => {});

  let tv = 0;
  try {
    const s2 = await sdocGet('users', uid);
    tv = s2.exists ? (Number(s2.data()?.tokenVersion) || 0) : 0;
  } catch {}
  const sessionToken = mintSession(uid, { email: prev.email || profile.email, tv });
  return res.status(200).json({
    sessionToken,
    user: { id: uid, name: prev.name || profile.name, email: prev.email || profile.email, phone: prev.phone || profile.phone },
  });
}

export default apiHandler(handler);
