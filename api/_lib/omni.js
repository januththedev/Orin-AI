/**
 * OmniRoute core for Orin AI — owner key pools + automatic failover.
 *
 * One module serves the website chatbot, the PC app (/api/chat) and the
 * Telegram bot: all three fan out through `route()`. Keys come from numbered
 * Vercel env vars (OPENROUTER_1 … OPENROUTER_20) so adding/rotating a key is
 * a redeploy with zero code changes. Legacy single vars (OPENROUTER_API_KEY)
 * still work as fallback.
 *
 * Failover: on 429 / 5xx / timeout / empty answer the key cools down for 60 s
 * and routing continues with the next key, then the next model hop. Auth and
 * unknown-model errors skip the rest of that hop (never burn good keys on a
 * config error). Keys are never logged — only last-4 in server logs.
 *
 * Free-only policy: chains are picked LIVE from OpenRouter's catalog on every
 * need (cached 1 h): coding → best free coding model, thinking → highest
 * intelligence free model, balanced → fastest smart free model, cheap → tiny
 * free model for titles/memory/helpers. No model id is hardcoded anywhere in
 * the selection path: if the catalog is unreachable the router reuses its
 * last good live selection (/tmp snapshot); if there is none it fails loudly
 * instead of answering with a stale hardcoded model.
 * detectStealth() flags newly-appeared free models so every client
 * (website, PC app, Telegram) can announce them.
 */

const COOLDOWN_MS = 60_000;
const TIMEOUT_MS = 60_000;
const MAX_NUMBERED = 20;
const THINKING_CHAR_LIMIT = 4000;
const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CATALOG_TTL_MS = 60 * 60 * 1000;

/** In-memory per-key health: key -> cooledUntil timestamp. */
const health = new Map();

/**
 * Collect keys for a provider: PREFIX_1 … PREFIX_20 first, else the legacy
 * comma-separated var (e.g. OPENROUTER_KEYS or OPENROUTER_API_KEY).
 */
export function pool(prefix, legacyVars = []) {
  const numbered = [];
  for (let i = 1; i <= MAX_NUMBERED; i++) {
    const key = (process.env[`${prefix}_${i}`] || '').trim();
    if (key) numbered.push(key);
  }
  if (numbered.length) return numbered;
  for (const name of legacyVars) {
    const raw = (process.env[name] || '').trim();
    if (!raw) continue;
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export const PROVIDER_POOLS = {
  openrouter: () => pool('OPENROUTER', ['OPENROUTER_KEYS', 'OPENROUTER_API_KEY']),
  groq: () => pool('GROQ', ['GROQ_API_KEY']),
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_SEARCH_MODEL = process.env.GROQ_SEARCH_MODEL || 'groq/compound-mini';

/** Last-good live selection, snapshotted to /tmp so a catalog outage falls
 * back to the most recent real ranking — never to a hardcoded model. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LAST_GOOD_PATH = path.join(os.tmpdir(), 'omni-catalog.json');

function readLastGood() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LAST_GOOD_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.chains) return parsed.chains;
  } catch {}
  return {};
}

function writeLastGood(tier, chain) {
  try {
    const chains = { ...readLastGood(), [tier]: chain };
    fs.writeFileSync(LAST_GOOD_PATH, JSON.stringify({ at: Date.now(), chains }));
  } catch {}
}

/** Live catalog: fetched from OpenRouter, cached 1 h, stale on failure. */
let catalogCache = { at: 0, models: [] };

function isFreeModel(m) {
  if (typeof m.id === 'string' && m.id.endsWith(':free')) return true;
  const p = m.pricing || {};
  return Number(p.prompt) === 0 && Number(p.completion) === 0 && !!m.id;
}

async function fetchCatalog() {
  if (Date.now() - catalogCache.at < CATALOG_TTL_MS && catalogCache.models.length) {
    return catalogCache.models;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(CATALOG_URL, {
      signal: ctrl.signal,
      headers: { 'HTTP-Referer': 'https://orinai.org', 'X-Title': 'Orin AI' },
    });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    const models = (json.data || [])
      .filter(isFreeModel)
      .map((m) => ({
        id: m.id,
        context_length: m.context_length || 0,
        created: m.created || 0,
        supported_parameters: m.supported_parameters || [],
      }));
    if (models.length) catalogCache = { at: Date.now(), models };
    return catalogCache.models;
  } catch {
    return catalogCache.models; // stale or empty → caller falls back
  } finally {
    clearTimeout(timer);
  }
}

/** Billions of params from ids like `…-550b-…`, `…-3b-…`. */
function paramsOf(m) {
  const hit = /(\d+(?:\.\d+)?)b(?!its)/i.exec(m.id);
  return hit ? parseFloat(hit[1]) : null;
}

function supportsReasoning(m) {
  const p = m.supported_parameters;
  return Array.isArray(p) && (p.includes('reasoning') || p.includes('include_reasoning'));
}

function isFresh(m) {
  return m.created * 1000 > Date.now() - 180 * 24 * 60 * 60 * 1000;
}

/** Coding: code-named models first, then big context + serious size. */
function scoreCoding(m) {
  const id = m.id.toLowerCase();
  let s = 0;
  if (/coder|coding|\bcode\b|laguna|devstral|codestral|kat-coder|deepseek|qwq/.test(id)) s += 100;
  else if (/instruct|chat/.test(id)) s += 25;
  if (supportsReasoning(m)) s += 10;
  s += Math.min(30, (m.context_length || 0) / 1024 / 8);
  const p = paramsOf(m);
  if (p && p >= 20 && p <= 600) s += 10;
  if (isFresh(m)) s += 10;
  return s;
}

/** Thinking: raw intelligence — reasoning support + parameter scale. */
function scoreThinking(m) {
  const p = paramsOf(m);
  let s = 0;
  if (supportsReasoning(m)) s += 60;
  s += p ? Math.min(50, Math.log10(Math.max(p, 1)) * 25) : 15;
  s += Math.min(20, (m.context_length || 0) / 1024 / 50);
  if (p && p < 7) s -= 30; // too small to reason deeply
  if (isFresh(m)) s += 10;
  return s;
}

/** Balanced: fast AND smart — mid-size instruct models, giants too slow. */
function scoreBalanced(m) {
  const id = m.id.toLowerCase();
  const p = paramsOf(m);
  let s = 0;
  if (/instruct|chat/.test(id)) s += 30;
  if (p) {
    const dist = Math.abs(Math.log10(p / 30));
    s += Math.max(0, 40 - dist * 30);
    if (p > 300) s -= 25;
  } else {
    s += 20;
  }
  s += Math.min(20, (m.context_length || 0) / 1024 / 12);
  if (supportsReasoning(m)) s += 10;
  if (isFresh(m)) s += 10;
  return s;
}

/** Cheap: tiny + quick, for titles / memory / JSON helpers. */
function scoreCheap(m) {
  const id = m.id.toLowerCase();
  const p = paramsOf(m);
  let s = 0;
  s += p ? Math.max(0, 40 - Math.log10(Math.max(p, 1)) * 15) : 15;
  if (/instruct|flash|mini|small|nano|lite|3b|7b|8b/.test(id)) s += 20;
  if (isFresh(m)) s += 5;
  return s;
}

const SCORERS = { coding: scoreCoding, thinking: scoreThinking, balanced: scoreBalanced, cheap: scoreCheap };

/**
 * Ranked live chain for a tier (top 6). Falls back to the last good live
 * selection; fails loudly when there is neither — a stale hardcoded model
 * would only 404 anyway.
 */
export async function chainFor(tier) {
  const models = await fetchCatalog();
  if (models.length) {
    const ranked = models
      .map((m) => ({ m, s: SCORERS[tier](m) }))
      .sort((a, b) => b.s - a.s)
      .map((r) => r.m.id);
    const chain = [...new Set(ranked.slice(0, 6))];
    writeLastGood(tier, chain);
    console.log(`[omni] live ${tier}: ${chain[0]} (+${chain.length - 1} fallbacks)`);
    return chain;
  }
  const last = readLastGood()[tier] || [];
  if (last.length) {
    console.log(`[omni] catalog unreachable — reusing last good ${tier}: ${last[0]}`);
    return last;
  }
  throw new Error(`No ${tier} models reachable right now (catalog down, no cached selection).`);
}

function prettyLabel(id) {
  const name = id.split('/').pop().replace(/:free$/, '').replace(/[-_]/g, ' ');
  return name.replace(/\b\w/g, (c) => c.toUpperCase()) + ' · free';
}

const STEALTH_DAYS = 7;
const STEALTH_NAME = /stealth|optimus|quasar|alpha|experimental|unnamed|mystery/i;

/**
 * Stealth-model detection: free models OpenRouter added recently (by catalog
 * `created` date) or shipping under an unannounced/stealth-style name.
 * Stateless — derived purely from the live catalog, so both the website, the
 * PC app, and Telegram can announce the same set. Never includes the
 * `openrouter/free` meta-router itself.
 */
export function detectStealth(models) {
  const cutoff = Date.now() / 1000 - STEALTH_DAYS * 24 * 60 * 60;
  const out = [];
  for (const m of models || []) {
    if (!m || typeof m.id !== 'string' || m.id === 'openrouter/free') continue;
    const fresh = (m.created || 0) > cutoff;
    const stealthy = STEALTH_NAME.test(m.id);
    if (!fresh && !stealthy) continue;
    out.push({
      id: m.id,
      label: prettyLabel(m.id),
      reason: fresh && stealthy ? 'new + stealth-named' : fresh ? 'new free model' : 'stealth-named',
    });
  }
  return out;
}

/** Live catalog for GET /api/models: top 3 per tier + defaults + stealth.
 * Degrades per-tier (empty list) instead of failing the whole endpoint. */
export async function liveCatalog() {
  const out = {};
  const defaults = {};
  for (const tier of ['coding', 'thinking', 'balanced']) {
    let chain = [];
    try {
      chain = await chainFor(tier);
    } catch {
      chain = [];
    }
    const top = chain.slice(0, 3);
    out[tier] = top.map((id, i) => ({ id, label: prettyLabel(id), default: i === 0 }));
    if (top[0]) defaults[tier] = top[0];
  }
  const models = await fetchCatalog();
  return { tiers: out, defaults, stealth: detectStealth(models), updatedAt: Date.now() };
}

/** Pinned model allowlist: live catalog first, last-good selection fallback. */
export async function isAllowedModel(id) {
  if (typeof id !== 'string' || !id) return false;
  const models = await fetchCatalog();
  if (models.length) return models.some((m) => m.id === id);
  return Object.values(readLastGood()).some((chain) => chain.includes(id));
}

function last4(key) {
  return key.length > 4 ? key.slice(-4) : '****';
}

function truncate(text, limit) {
  if (!text || text.length <= limit) return text || '';
  return text.slice(0, limit) + '… (truncated)';
}

/**
 * Classify an HTTP outcome into router action. Exported for tests.
 * - 'retry'    → cool this key, try the NEXT KEY (429/5xx/timeout/empty).
 * - 'dead-key' → this key's credentials are bad, quarantine it for the rest
 *                 of the request and try the NEXT KEY (401/403).
 * - 'hop'      → the MODEL is the problem, skip to the NEXT MODEL (400/404).
 */
export function classifyStatus(status) {
  if (status === 429 || status >= 500 || status === 0) return 'retry';
  if (status === 401 || status === 403) return 'dead-key';
  if (status === 400 || status === 404) return 'hop';
  return 'hop';
}

/**
 * One attempt against OpenRouter with a single key.
 * Returns { ok, text, thinking, action } where action is one of the
 * classifyStatus() outcomes ('retry' only when the body was unusable).
 */
async function attempt(key, model, messages, wantThinking, extra = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const body = { model, messages, ...extra };
    if (wantThinking) body.include_reasoning = true;
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://orinai.org',
        'X-Title': 'Orin AI',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) return { ok: false, action: 'retry' };
    if (!res.ok) return { ok: false, action: classifyStatus(res.status) };
    const json = await res.json().catch(() => ({}));
    const message = json.choices?.[0]?.message;
    const text = (message?.content || '').trim();
    if (!text) return { ok: false, action: 'retry' };
    let thinking = '';
    if (wantThinking) {
      const raw = message?.reasoning;
      thinking = truncate(Array.isArray(raw) ? raw.join('\n') : String(raw || ''), THINKING_CHAR_LIMIT);
      if (!thinking && Array.isArray(message?.reasoning_details)) {
        thinking = truncate(
          message.reasoning_details
            .map((d) => (typeof d === 'string' ? d : d?.text || d?.summary || ''))
            .filter(Boolean)
            .join('\n'),
          THINKING_CHAR_LIMIT,
        );
      }
    }
    return { ok: true, text, thinking, message };
  } catch {
    return { ok: false, action: 'retry' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Groq web search (groq/compound-mini): the model decides server-side when
 * to search and returns automatic citations. Used for freshness-intent chat
 * when GROQ_API_KEY is set — cheaper and faster than the OpenRouter web
 * plugin, and Groq's free tier covers it. Falls back to the OpenRouter
 * plugin path (caller-side) on any failure.
 *
 * Groq messages must be plain text parts — image/data parts are dropped
 * (their text is kept).
 */
export function groqTextMessages(messages) {
  return (messages || []).map((m) => {
    let content = m?.content;
    if (Array.isArray(content)) {
      content = content
        .map((p) => (typeof p === 'string' ? p : p?.text || ''))
        .filter(Boolean)
        .join('\n');
    }
    return { role: m?.role === 'assistant' || m?.role === 'system' ? m.role : 'user', content: String(content || '') };
  }).filter((m) => m.content);
}

function groqLinksFrom(message) {
  const out = [];
  const tools = message?.executed_tools;
  if (!Array.isArray(tools)) return out;
  for (const t of tools) {
    const results = t?.search_results;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      const url = r?.url || r?.link;
      if (url) out.push({ uri: url, title: r?.title || url });
    }
  }
  return out;
}

export async function groqSearch(messages) {
  const keys = PROVIDER_POOLS.groq();
  if (!keys.length) throw new Error('No Groq keys configured (set GROQ_API_KEY in Vercel).');
  const key = keys[Math.floor(Math.random() * keys.length)];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: GROQ_SEARCH_MODEL, messages: groqTextMessages(messages) }),
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    const message = json.choices?.[0]?.message;
    const text = (message?.content || '').trim();
    if (!text) throw new Error('Empty Groq answer');
    return { text, links: groqLinksFrom(message), model: GROQ_SEARCH_MODEL, via: 'groq' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Web-grounding citations from the OpenRouter web plugin
 * (`annotations: [{ type: 'url_citation', url_citation: { url, title } }]`).
 * Pure — safe to unit-test.
 */
export function extractWebCitations(message) {
  const out = [];
  const annotations = message?.annotations;
  if (!Array.isArray(annotations)) return out;
  for (const a of annotations) {
    const cite = a?.url_citation;
    if (a?.type === 'url_citation' && cite?.url) {
      out.push({ uri: cite.url, title: cite.title || cite.url });
    }
  }
  return out;
}

/**
 * Route across the chain × key pool. First success wins — and a dead pool
 * never blocks the next model:
 *   - bad-credential keys are quarantined for the rest of the request,
 *   - model-level rejections skip straight to the next model in the tier,
 *   - if every key is cooling down, one last-resort pass ignores cooldowns
 *     rather than failing instantly.
 * onAttempt({ model, keyLast4, ok }) feeds logs / analytics.
 */
export async function route(chain, messages, { wantThinking = false, extra = {}, onAttempt = null } = {}) {
  const allKeys = PROVIDER_POOLS.openrouter();
  if (!allKeys.length) throw new Error('No OpenRouter keys configured (set OPENROUTER_1 … in Vercel).');
  const errors = [];
  const dead = new Set();
  let attempts = 0;

  const pass = async (ignoreCooldown) => {
    for (const model of chain) {
      for (const key of allKeys) {
        if (dead.has(key)) continue;
        if (!ignoreCooldown && (health.get(key) || 0) >= Date.now()) continue;
        attempts++;
        const r = await attempt(key, model, messages, wantThinking, extra);
        if (onAttempt) {
          try { onAttempt({ model, keyLast4: last4(key), ok: r.ok }); } catch {}
        }
        if (r.ok) {
          return {
            text: r.text,
            thinking: r.thinking || '',
            model,
            links: extractWebCitations(r.message),
          };
        }
        if (r.action === 'dead-key') {
          dead.add(key);
          errors.push(`${model}: bad key`);
          continue; // next key, same model — others may be fine
        }
        if (r.action === 'retry') {
          health.set(key, Date.now() + COOLDOWN_MS);
          errors.push(`${model}: retryable`);
          continue; // next key, same model
        }
        errors.push(`${model}: rejected`);
        break; // model-level problem — next model in the tier
      }
    }
    return null;
  };

  const first = await pass(false);
  if (first) return first;
  if (attempts === 0) {
    // Nothing was even tried — every key is cooling down. Try once more
    // anyway instead of failing instantly.
    const lastResort = await pass(true);
    if (lastResort) return lastResort;
  }
  if (!chain.length) throw new Error('No models available in this tier right now.');
  throw new Error(`All providers failed: ${errors.join('; ') || 'all keys cooling down'}`);
}

/** Resolve which chain + pinned model to use for a chat request. */
export async function resolveChain({ model, thinking } = {}) {
  if (model && (await isAllowedModel(model))) {
    const balanced = await chainFor('balanced');
    return { chain: [model, ...balanced.filter((m) => m !== model)], pinned: model };
  }
  // PC app tiers: pro = max intelligence, flash = balanced speed+smarts.
  if (model === 'orin-pro' || thinking) return { chain: await chainFor('thinking'), pinned: null };
  if (model === 'orin-flash') return { chain: await chainFor('balanced'), pinned: null };
  if (thinking) return { chain: await chainFor('thinking'), pinned: null };
  return { chain: await chainFor('balanced'), pinned: null };
}

/** Coding default: best free coding model first (live). */
export async function codingChain() {
  return chainFor('coding');
}
