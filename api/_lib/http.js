/**
 * Shared HTTP plumbing: origin allow-listed CORS + uniform error mapping +
 * request-ID structured logging.
 * apiHandler(handler, opts) wraps a request handler with:
 *   - CORS headers only for known origins (agents/scripts get no CORS headers; they don't need them)
 *   - 204 preflight responses
 *   - x-request-id on every response, echoed from inbound header when present
 *   - one structured log line per request (method, path, status, ms, requestId)
 *   - thrown { code } errors mapped to JSON status codes, everything else → 500
 */
import crypto from 'crypto';

const ALLOWED_ORIGINS = new Set([
  'https://orinai.org',
  'https://www.orinai.org',
  'https://orin-ai.vercel.app',
  // Orin first-party satellites (same login everywhere)
  'https://chat.orinai.org',
  'https://code.orinai.org',
  'https://agent.orinai.org',
  'https://tools.orinai.org',
  'https://mcp.orinai.org',
  'https://router.orinai.org',
  'https://console.orinai.org',
  // local dev servers
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  // Capacitor / native WebViews
  'capacitor://localhost',
  'ionic://localhost',
  // Tauri v2 desktop shell (WebView2 production origin + custom protocol)
  'tauri://localhost',
  'http://tauri.localhost',
]);

export function applyCors(req, res, extraHeaders = []) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', ['Content-Type', 'Authorization', ...extraHeaders].join(', '));
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
}

export function apiHandler(handler, opts = {}) {
  const extraHeaders = opts.headers || [];
  return async function wrapped(req, res) {
    const startedAt = Date.now();
    const requestId = String(req.headers['x-request-id'] || '').slice(0, 64)
      || crypto.randomUUID();
    res.setHeader('x-request-id', requestId);

    applyCors(req, res, extraHeaders);
    if (req.method === 'OPTIONS') return res.status(204).end();

    let status = 500;
    try {
      const out = await handler(req, res);
      status = res.statusCode;
      return out;
    } catch (e) {
      const code = e?.code;
      if (Number.isInteger(code) && code >= 400 && code < 600) {
        status = code;
        log(req, requestId, startedAt, status, e.message);
        return res.status(code).json({ error: e.message, requestId });
      }
      status = 500;
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        method: req.method,
        path: req.url,
        msg: e?.stack || String(e),
      }));
      return res.status(500).json({ error: 'Internal error', requestId });
    } finally {
      log(req, requestId, startedAt, status);
    }
  };
}

function log(req, requestId, startedAt, status, note) {
  console.log(JSON.stringify({
    level: status >= 500 ? 'error' : 'info',
    requestId,
    method: req.method,
    path: req.url,
    status,
    ms: Date.now() - startedAt,
    ...(note ? { note } : {}),
  }));
}
