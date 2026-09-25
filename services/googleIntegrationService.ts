/**
 * googleIntegrationService — single Google identity with scoped permissions.
 * Token exchange and refresh are handled server-side via /api/auth/google.
 * This module only calls the backend — never touches raw tokens.
 */
import { sessionService } from './sessionService';

// ── Scope definitions per feature module ─────────────────────────────────────
export const GOOGLE_MODULES = {
  gmail:    { scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],        label: 'Gmail',          icon: 'fa-envelope',    color: 'text-red-500' },
  drive:    { scopes: ['https://www.googleapis.com/auth/drive.file'],                                                          label: 'Google Drive',   icon: 'fa-hard-drive',  color: 'text-yellow-500' },
  calendar: { scopes: ['https://www.googleapis.com/auth/calendar'],                                                            label: 'Calendar',       icon: 'fa-calendar',    color: 'text-blue-500' },
  people:   { scopes: ['openid', 'email', 'profile'],                                                                          label: 'Contacts',       icon: 'fa-address-book', color: 'text-indigo-500' },
  docs:     { scopes: ['https://www.googleapis.com/auth/documents'],                                                           label: 'Google Docs',    icon: 'fa-file-lines',  color: 'text-blue-400' },
  slides:   { scopes: ['https://www.googleapis.com/auth/presentations'],                                                       label: 'Google Slides',  icon: 'fa-display',     color: 'text-orange-400' },
  sheets:   { scopes: ['https://www.googleapis.com/auth/spreadsheets'],                                                        label: 'Google Sheets',  icon: 'fa-table',       color: 'text-green-500' },
  youtube:  { scopes: ['https://www.googleapis.com/auth/youtube.readonly'],                                                    label: 'YouTube',        icon: 'fa-youtube',     color: 'text-red-600' },
  fitness:  { scopes: ['https://www.googleapis.com/auth/fitness.activity.read', 'https://www.googleapis.com/auth/fitness.body.read'], label: 'Google Fit', icon: 'fa-heart-pulse', color: 'text-pink-500' },
} as const;

export type GoogleModuleId = keyof typeof GOOGLE_MODULES;

// ── In-memory status cache (refreshed from backend on demand) ─────────────────
let _statusCache: Record<string, boolean> = {};
let _statusFetchedAt = 0;

async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const tok = await (sessionService as any).getIdToken?.();
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch { return {}; }
}

// ── Status ────────────────────────────────────────────────────────────────────
export async function fetchModuleStatus(): Promise<Record<string, boolean>> {
  if (Date.now() - _statusFetchedAt < 30_000) return _statusCache; // 30s cache
  try {
    const headers = await getAuthHeader();
    const r = await fetch('/api/auth/google', { headers });
    if (r.ok) {
      const d = await r.json();
      _statusCache = d.modules || {};
      _statusFetchedAt = Date.now();
    }
  } catch {}
  return _statusCache;
}

export async function isModuleEnabled(module: GoogleModuleId): Promise<boolean> {
  const s = await fetchModuleStatus();
  return !!s[module];
}

export function getGrantedModules(): GoogleModuleId[] {
  return Object.entries(_statusCache).filter(([, v]) => v).map(([k]) => k as GoogleModuleId);
}

// ── Incremental consent OAuth ─────────────────────────────────────────────────
const CLIENT_ID = (typeof window !== 'undefined') ? (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '' : '';
const REDIRECT  = (typeof window !== 'undefined') ? `${window.location.origin}/auth/google/callback` : '';

export async function requestModuleConsent(module: GoogleModuleId): Promise<boolean> {
  if (!CLIENT_ID) { console.warn('[google] Set VITE_GOOGLE_CLIENT_ID env var'); return false; }
  const scopes = GOOGLE_MODULES[module].scopes.join(' ');
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  sessionStorage.setItem('g_pkce_verifier', verifier);
  sessionStorage.setItem('g_pkce_module', module);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.href = url.toString();
  return true;
}

// Called on redirect back — routes token exchange through backend
export async function handleOAuthCallback(): Promise<{ module: GoogleModuleId } | null> {
  if (!window.location.pathname.includes('/auth/google/callback')) return null;
  const params = new URLSearchParams(window.location.search);
  const code     = params.get('code');
  const verifier = sessionStorage.getItem('g_pkce_verifier');
  const module   = sessionStorage.getItem('g_pkce_module') as GoogleModuleId | null;
  if (!code || !verifier || !module) return null;

  try {
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
    const r = await fetch('/api/auth/google', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'exchange', code, verifier, module, redirectUri: REDIRECT }),
    });
    if (r.ok) {
      sessionStorage.removeItem('g_pkce_verifier');
      sessionStorage.removeItem('g_pkce_module');
      window.history.replaceState({}, '', '/');
      _statusFetchedAt = 0; // bust cache
      return { module };
    }
  } catch {}
  return null;
}

export async function disableModule(module: GoogleModuleId): Promise<void> {
  try {
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
    await fetch('/api/auth/google', { method: 'POST', headers, body: JSON.stringify({ action: 'disable', module }) });
    _statusCache[module] = false;
  } catch {}
}

export async function enableModule(module: GoogleModuleId): Promise<void> {
  // Re-request consent to re-enable a disconnected module
  await requestModuleConsent(module);
}

// ── Get a valid token (server handles refresh automatically) ──────────────────
export async function getValidToken(module: GoogleModuleId): Promise<string | null> {
  try {
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
    const r = await fetch('/api/auth/google', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'getToken', module }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.accessToken || null;
  } catch { return null; }
}

// Kept for backward-compat — synchronous callers get null, must migrate to getValidToken()
export function getModuleToken(_module: GoogleModuleId): string | null { return null; }

// ── Google API helpers (called with token from getValidToken) ─────────────────
const GOOGLE_API_ORIGINS = new Set(['https://gmail.googleapis.com', 'https://www.googleapis.com', 'https://docs.googleapis.com', 'https://slides.googleapis.com', 'https://sheets.googleapis.com', 'https://drive.googleapis.com']);
async function gFetch(module: GoogleModuleId, url: string, opts?: RequestInit): Promise<any> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !GOOGLE_API_ORIGINS.has(target.origin)) throw new Error('Google API URL is not allowed');
  const token = await getValidToken(module);
  if (!token) throw new Error(`No token for ${module}. Grant access first.`);
  const res = await fetch(url, { ...opts, headers: { ...(opts?.headers || {}), Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json();
}

// Gmail
export async function gmailListThreads(maxResults = 10) {
  return gFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${maxResults}&labelIds=INBOX`);
}
export async function gmailGetThread(id: string) {
  return gFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`);
}
export async function gmailSend(to: string, subject: string, body: string) {
  const raw = btoa(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}`).replace(/\+/g, '-').replace(/\//g, '_');
  return gFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
}

// Calendar
export async function calendarListEvents(maxResults = 10) {
  const now = new Date().toISOString();
  return gFetch('calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${maxResults}&timeMin=${now}&singleEvents=true&orderBy=startTime`);
}
export async function calendarCreateEvent(summary: string, start: string, end: string, description?: string) {
  return gFetch('calendar', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, description, start: { dateTime: start, timeZone: 'Asia/Colombo' }, end: { dateTime: end, timeZone: 'Asia/Colombo' } }),
  });
}

// Drive
export async function driveListFiles(q = '') {
  return gFetch('drive', `https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,modifiedTime)${q ? `&q=${encodeURIComponent(q)}` : ''}`);
}

// Docs / Slides / Sheets
export async function docsCreate(title: string)   { return gFetch('docs',   'https://docs.googleapis.com/v1/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); }
export async function slidesCreate(title: string) { return gFetch('slides', 'https://slides.googleapis.com/v1/presentations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); }
export async function sheetsCreate(title: string) { return gFetch('sheets', 'https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: { title } }) }); }

// YouTube
export async function youtubeSearch(q: string, maxResults = 5) {
  return gFetch('youtube', `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${maxResults}&q=${encodeURIComponent(q)}&type=video`);
}

// Fitness
export async function fitnessGetActivity() {
  const now = Date.now();
  const week = now - 7 * 24 * 3600 * 1000;
  return gFetch('fitness', 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }], bucketByTime: { durationMillis: 86400000 }, startTimeMillis: week, endTimeMillis: now }),
  });
}
