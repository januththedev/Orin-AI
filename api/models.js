/**
 * GET /api/models — free-model catalog for the chatbot UI.
 *
 * No auth required (ids and labels only, no keys). The UI shows these tiers;
 * coding always defaults to the best free coding model. `model` sent back to
 * POST /api/chat must be one of these ids (server allowlists).
 */
import { liveCatalog } from './_lib/omni.js';
import { apiHandler } from './_lib/http.js';

export const config = { maxDuration: 10 };

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }
  // Live selection: best free models right now, static fallback inside.
  const catalog = await liveCatalog();
  return res.status(200).json(catalog);
}

export default apiHandler(handler);
