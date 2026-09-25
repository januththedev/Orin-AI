import { apiHandler } from './_lib/http.js';
export const config = { maxDuration: 10 };
async function handler(req, res) { res.setHeader('Cache-Control', 'no-store'); return res.status(410).json({ error: { code: 'ORIN_REMOTE_CONTROL_DISABLED', message: 'PC phone linking is disabled until Orin Agent has signed approval grants.', retryable: false, request_id: req.headers?.['x-request-id'] || '' } }); }
export default apiHandler(handler);
