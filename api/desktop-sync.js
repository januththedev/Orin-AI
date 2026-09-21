/**
 * GET  /api/desktop-sync — caller's desktop sync blob (or nulls if none).
 * PUT  /api/desktop-sync — replaces it. Body: { blob: object, schemaVersion? } ≤ 512 KB.
 * Auth: Firebase ID token via _lib/firebase requireUser.
 * Storage: Neon `desktop_sync` docs, id = uid. Last-write-wins v1.
 */
import { requireUser, httpError } from './_lib/firebase.js';
import { sdocGet, sdocSet, TS } from './_lib/store.js';
import { apiHandler } from './_lib/http.js';

export const config = { maxDuration: 15 };

const MAX_BYTES = 512 * 1024;

async function handler(req, res) {
  const decoded = await requireUser(req);
  const uid = decoded.uid;

  if (req.method === 'GET') {
    const snap = await sdocGet('desktop_sync', uid);
    if (!snap.exists) {
      return res.status(200).json({ blob: null, schemaVersion: null, updatedAt: null });
    }
    const d = snap.data();
    return res.status(200).json({
      blob: d.blob ?? null,
      schemaVersion: d.schemaVersion ?? 1,
      updatedAt: d.updatedAt ?? null,
    });
  }

  if (req.method === 'PUT') {
    const blob = (req.body || {}).blob;
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
      throw httpError(400, 'body.blob must be a JSON object');
    }
    const serialized = JSON.stringify(blob);
    if (serialized.length > MAX_BYTES) {
      throw httpError(413, `Sync payload too large (${serialized.length} > ${MAX_BYTES} bytes)`);
    }
    await sdocSet('desktop_sync', uid, {
      blob,
      schemaVersion: Number((req.body || {}).schemaVersion) || 1,
      sizeBytes: serialized.length,
      updatedAt: TS(),
    });
    return res.status(200).json({ ok: true });
  }

  throw httpError(405, 'GET or PUT only');
}

export default apiHandler(handler);
