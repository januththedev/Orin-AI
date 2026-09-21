/**
 * POST /api/auth/neon — bridge Neon Auth sessions into Firebase identity.
 *
 * The website signs in with Neon Auth (Google + any dashboard-enabled
 * method). This endpoint verifies the Neon access token (Ed25519/JWKS),
 * maps the Neon user to a Firebase user (auto-provisioned on first login),
 * and returns a Firebase custom token — so quotas, sync, device flow, and
 * the PC app keep working UNCHANGED.
 *
 * body: { action: 'exchange', token }
 *   → { customToken, user: { id, name, email, phone } }
 *
 * Mapping lives in `neon_links/{neonSub}`. No new deps.
 */
import { initAdmin, httpError } from '../_lib/firebase.js';
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

async function firebaseUidFor(sub, profile) {
  const link = await sdocGet('neon_links', String(sub));
  if (link.exists && link.data()?.firebaseUid) return link.data().firebaseUid;
  const create = { displayName: profile.name || undefined };
  if (profile.email) {
    create.email = profile.email;
    create.emailVerified = true; // verified by Neon, not by us
  }
  if (!profile.email && profile.phone) create.phoneNumber = profile.phone;
  if (profile.image) create.photoURL = profile.image;
  let uid;
  try {
    const record = await initAdmin().auth().createUser(create);
    uid = record.uid;
  } catch (e) {
    // Email already belongs to a password account — link to it instead of
    // forking a duplicate identity.
    if (profile.email && e?.code === 'auth/email-already-exists') {
      const existing = await initAdmin().auth().getUserByEmail(profile.email);
      uid = existing.uid;
    } else {
      throw e;
    }
  }
  await sdocSet('users', uid, {
    name: profile.name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    neonSub: String(sub),
    lastUpdated: TS(),
  }, true);
  await sdocSet('neon_links', String(sub), { firebaseUid: uid, createdAt: TS() });
  return uid;
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
  const uid = await firebaseUidFor(payload.sub, profile);
  const customToken = await initAdmin().auth().createCustomToken(uid);

  return res.status(200).json({
    customToken,
    user: { id: uid, name: profile.name, email: profile.email, phone: profile.phone },
  });
}

export default apiHandler(handler);
