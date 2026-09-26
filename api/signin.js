import crypto from 'node:crypto';
import { createBffSession } from './_lib/bff.js';
import { sdocSet, TS } from './_lib/store.js';
import { authenticateWithPassword } from './auth/password.js';

/**
 * Browser sign-in for every Orin product.
 *
 * The API already knew how to register and log in; what was missing was a page
 * a person can actually use. This serves one at https://orinai.org/signin and
 * it works with JavaScript disabled: the form posts back here, the session
 * cookie is set, and the browser is redirected to where they came from.
 *
 * The dangerous part is the redirect, so `return_to` is never trusted. It is
 * resolved against a fixed list of Orin origins and anything else falls back to
 * the apex. An open redirect here would let an attacker steal a session.
 */

export const config = { maxDuration: 10 };

const RETURN_ORIGINS = new Set([
  'https://orinai.org',
  'https://www.orinai.org',
  'https://chat.orinai.org',
  'https://code.orinai.org',
  'https://agent.orinai.org',
  'https://console.orinai.org',
  'https://tools.orinai.org',
  'https://automate.orinai.org',
  'https://mcp.orinai.org',
]);

const DEFAULT_RETURN = 'https://orinai.org/';
const CSRF_COOKIE = 'orin_signin_csrf';
const SESSION_DAYS = 30;

/** Resolve a return target to an absolute Orin URL, or the apex. */
export function safeReturn(raw) {
  const candidate = String(raw || '').trim();
  if (!candidate) return { url: DEFAULT_RETURN, origin: 'https://orinai.org' };
  // A bare path stays on the apex; anything absolute must be a known origin.
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return { url: new URL(candidate, DEFAULT_RETURN).toString(), origin: 'https://orinai.org' };
  }
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { url: DEFAULT_RETURN, origin: 'https://orinai.org' };
  }
  // `url.origin` excludes credentials, so https://user:pw@code.orinai.org would
  // otherwise pass the allowlist. Reject those outright: a credential-bearing
  // redirect target is a phishing shape, not something to silently clean up.
  if (url.username || url.password) {
    return { url: DEFAULT_RETURN, origin: 'https://orinai.org' };
  }
  if (url.protocol !== 'https:' || !RETURN_ORIGINS.has(url.origin)) {
    return { url: DEFAULT_RETURN, origin: 'https://orinai.org' };
  }
  // Fragments never belong in a redirect target; they can carry a token that
  // would land in the destination page.
  url.hash = '';
  return { url: url.toString(), origin: url.origin };
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function secure() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : '';
}

function constantTimeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page({ returnTo, error, identifier, registered, csrf }) {
  const notice = error
    ? `<p role="alert" class="err">${escapeHtml(error)}</p>`
    : registered
      ? '<p role="status" class="ok">Account created. Sign in below.</p>'
      : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in · Orin</title>
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0a0a0b; color:#f4f4f5;
         font:16px/1.55 'Space Grotesk', system-ui, -apple-system, sans-serif; padding:24px; }
  .card { width:100%; max-width:400px; }
  h1 { font-size:1.6rem; letter-spacing:-0.02em; margin:0 0 6px; }
  p.sub { color:#a1a1aa; margin:0 0 26px; font-size:.95rem; }
  form { display:grid; gap:14px; }
  label { display:grid; gap:6px; font-size:.82rem; color:#a1a1aa; }
  input { width:100%; padding:12px 14px; border-radius:11px; border:1px solid rgba(255,255,255,.12);
          background:#131316; color:#f4f4f5; font:inherit; }
  input:focus { outline:2px solid #22d3ee; outline-offset:1px; border-color:transparent; }
  button { padding:13px; border:0; border-radius:11px; font:inherit; font-weight:700; cursor:pointer;
           background:linear-gradient(120deg,#22d3ee,#38bdf8); color:#04222a; }
  button.secondary { background:#1c1c21; color:#f4f4f5; border:1px solid rgba(255,255,255,.12); }
  .switch { margin-top:20px; text-align:center; font-size:.9rem; color:#a1a1aa; }
  .switch button { background:none; color:#22d3ee; padding:0; font-weight:600; text-decoration:underline; }
  .err { background:rgba(248,113,113,.1); border:1px solid rgba(248,113,113,.35); color:#fca5a5;
         padding:10px 12px; border-radius:10px; font-size:.9rem; }
  .ok { background:rgba(74,222,128,.1); border:1px solid rgba(74,222,128,.32); color:#86efac;
        padding:10px 12px; border-radius:10px; font-size:.9rem; }
  .brand { display:flex; align-items:center; gap:9px; margin-bottom:20px; font-weight:700; letter-spacing:-.01em; }
  .dot { width:10px; height:10px; border-radius:50%; background:#22d3ee; }
  footer { margin-top:24px; font-size:.8rem; color:#63636b; text-align:center; }
</style>
</head>
<body>
<main class="card">
  <div class="brand"><span class="dot" aria-hidden="true"></span> Orin</div>
  <h1>${registered ? 'Create your account' : 'Sign in'}</h1>
  <p class="sub">One Orin account works across Chat, Code, Agent, Router and MCP.</p>
  ${notice}
  <form method="post" action="/signin" autocomplete="on">
    <input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
    <input type="hidden" name="return_to" value="${escapeHtml(returnTo)}" />
    <input type="hidden" name="intent" value="${registered ? 'register' : 'login'}" />
    <label>Email or phone
      <input name="identifier" value="${escapeHtml(identifier)}" autocomplete="username" required autofocus />
    </label>
    <label>Password
      <input name="password" type="password" autocomplete="${registered ? 'new-password' : 'current-password'}" required />
    </label>
    <button type="submit">${registered ? 'Create account' : 'Sign in'}</button>
  </form>
  <p class="switch">
    <button type="button" id="toggle">${registered ? 'Already have an account? Sign in' : 'New to Orin? Create an account'}</button>
  </p>
  <footer>Orin · <a href="https://orinai.org" style="color:#63636b">orinai.org</a></footer>
</main>
<script>
  // The form posts back to the server; this only flips between sign-in and
  // register without a round trip, so it degrades to a working form with
  // JavaScript disabled.
  document.getElementById('toggle')?.addEventListener('click', function () {
    const other = new URL(window.location.href);
    other.searchParams.set('mode', this.textContent.indexOf('Create') === 0 ? 'register' : 'login');
    window.location.href = other.toString();
  });
</script>
</body>
</html>`;
}

function send(res, status, body, contentType = 'text/html; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(body);
}

async function readForm(req) {
  const raw = req.body;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = typeof raw === 'string' ? raw : '';
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/signin', 'https://orinai.org');
  const { url: returnTo } = safeReturn(url.searchParams.get('return_to'));

  if (req.method === 'GET') {
    const csrf = crypto.randomBytes(24).toString('base64url');
    res.setHeader('Set-Cookie', [`${CSRF_COOKIE}=${csrf}; Path=/signin; Max-Age=3600; HttpOnly; SameSite=Lax${secure()}`]);
    return send(res, 200, page({
      returnTo,
      csrf,
      identifier: '',
      error: '',
      registered: url.searchParams.get('mode') === 'register',
    }));
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  }

  const form = await readForm(req);
  const posted = safeReturn(form.return_to).url;
  const identifier = String(form.identifier || '').trim().slice(0, 200);
  const password = String(form.password || '');
  const intent = form.intent === 'register' ? 'register' : 'login';

  const fail = (error, status = 401) => send(res, status, page({ returnTo: posted, csrf: '', identifier, error, registered: intent === 'register' }));

  // Form CSRF. The token is issued on GET and bound to this form only.
  const cookieToken = parseCookies(req)[CSRF_COOKIE] || '';
  const postedToken = String(form.csrf || '');
  if (!cookieToken || !postedToken || !constantTimeEqual(cookieToken, postedToken)) {
    return send(res, 403, page({ returnTo: posted, csrf: '', identifier, error: 'This form expired. Reload the page and try again.', registered: intent === 'register' }));
  }

  if (!identifier || !password) return fail('Email/phone and password are required.', 400);
  if (password.length > 512) return fail('That password is too long.', 400);

  // Clear the form token whatever happens; a successful sign-in replaces
  // it with the session CSRF token that createBffSession issues.
  res.setHeader('Set-Cookie', [`${CSRF_COOKIE}=; Path=/signin; Max-Age=0; HttpOnly; SameSite=Lax${secure()}`]);

  // The same implementation the JSON API uses, so rate limiting, hashing, and
  // the "invalid credentials" message cannot differ between the two doors.
  const ip = clientIpFrom(req);
  let result;
  try {
    result = intent === 'register'
      ? await authenticateWithPassword({ action: 'register', identifier, password, name: String(form.name || identifier).slice(0, 80), phone: String(form.phone || '').slice(0, 32) }, ip)
      : await authenticateWithPassword({ action: 'login', identifier, password }, ip);
  } catch (error) {
    const status = Number.isInteger(error?.code) && error.code >= 400 && error.code < 600 ? error.code : 401;
    // The message is the same one the API returns, and it never reveals whether
    // an account exists.
    return fail(error?.message || 'Invalid credentials', status);
  }

  const uid = String(result.user.id);
  const email = String(result.user.email || '');
  await createBffSession(res, uid, 'orin-web', email);
  await sdocSet('signins', `${uid}/${Date.now()}`, { uid, email, at: TS(), via: 'web' }, true).catch(() => {});

  // A JSON caller (the Orin Code web client) gets the token; a browser form
  // gets a redirect back to the product it came from.
  if (String(req.headers?.accept || '').includes('application/json')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: true, user: result.user, return_to: posted }));
  }

  res.statusCode = 303;
  res.setHeader('Location', posted);
  res.setHeader('Cache-Control', 'no-store');
  return res.end();
}

function clientIpFrom(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '');
  return forwarded.split(',')[0]?.trim() || String(req.headers?.['x-real-ip'] || 'unknown');
}
