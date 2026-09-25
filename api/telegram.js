import { apiHandler } from './_lib/http.js';
export const config = { maxDuration: 10 };
async function handler(req, res) { res.setHeader('Cache-Control', 'no-store'); return res.status(410).json({ error: { code: 'ORIN_TELEGRAM_DISABLED', message: 'Telegram chat is disabled until the approved Agent/Router contract is integrated.', retryable: false, request_id: req.headers?.['x-request-id'] || '' } }); }
export default apiHandler(handler);
