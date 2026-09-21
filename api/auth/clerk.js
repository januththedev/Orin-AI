/**
 * POST /api/auth/clerk — bridge Clerk sessions into Firebase identity.
 *
 * The website signs in with Clerk (email/phone + password, verification
 * codes, magic links — all configured in the Clerk dashboard). This endpoint
 * verifies the Clerk session token, maps the Clerk user to a Firebase user
 * (auto-provisioned on first login), and returns a Firebase custom token —
 * so quotas, sync, device flow, and the PC app keep working UNCHANGED.
 *
 * body: { action: 'exchange', token }
 *   → { customToken, user: { id, name, email, phone } }
 *
 * Env: CLERK_SECRET_KEY. Mapping lives in `clerk_links/{clerkId}`.
 */
import { initAdmin, db, TS, httpError } from '../_lib/firebase.js';
import { apiHandler } from '../_lib/http.js';
import { rateLimit } from '../_lib/ratelimit.js';
import { verifyClerkToken, clerkUser } from '../_lib/clerk.js';

export const config = { maxDuration: 30 };

function clientIp(req) {
  return ((req.headers['x-forwarded-for'] || '').split(',')[0]).trim() || 'unknown';
}

async function firebaseUidFor(clerk) {
  const linkRef = db().collection('clerk_links').doc(String(clerk.id));
  const link = await linkRef.get();
  if (link.exists && link.data()?.firebaseUid) return link.data().firebaseUid;
  // First Clerk login: provision a Firebase user mirroring the profile.
  const create = { displayName: clerk.name || undefined };
  if (clerk.email) {
    create.email = clerk.email;
    create.emailVerified = true; // verified by Clerk, not by us
  }
  if (!clerk.email && clerk.phone) create.phoneNumber = clerk.phone;
  let uid;
  try {
    const record = await initAdmin().auth().createUser(create);
    uid = record.uid;
  } catch (e) {
    // Email already belongs to a password account — link to it instead of
    // forking a duplicate identity.
    if (clerk.email && e?.code === 'auth/email-already-exists') {
      const existing = await initAdmin().auth().getUserByEmail(clerk.email);
      uid = existing.uid;
    } else {
      throw e;
    }
  }
  await db().collection('users').doc(uid).set({
    name: clerk.name || '',
    email: clerk.email || '',
    phone: clerk.phone || '',
    clerkId: clerk.id,
    lastUpdated: TS(),
  }, { merge: true });
  await linkRef.set({ firebaseUid: uid, createdAt: TS() });
  return uid;
}

async function handler(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const { action, token } = req.body || {};
  if (action !== 'exchange') throw httpError(400, 'Unknown action');
  if (!(await rateLimit('clerk-exchange:' + clientIp(req), 30, 60_000))) {
    throw httpError(429, 'Too many attempts. Try again later.');
  }

  const payload = await verifyClerkToken(token);
  const clerk = await clerkUser(payload.sub);
  const uid = await firebaseUidFor(clerk);
  const customToken = await initAdmin().auth().createCustomToken(uid);

  const s = { id: uid, name: clerk.name, email: clerk.email, phone: clerk.phone };
  return res.status(200).json({
    customToken,
    user: { id: s.id, name: s.name, email: s.email, phone: s.phone },
  });
}

export default apiHandler(handler);
