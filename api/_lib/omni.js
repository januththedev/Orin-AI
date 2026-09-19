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
 * Free-only policy: every chain below uses OpenRouter `:free` models.
 *   - coding   → best free coding model first (Poolside Laguna M.1)
 *   - thinking → highest-intelligence free model (Nemotron 3 Ultra 550B)
 *   - balanced → fast + smart free model (Qwen3 Next 80B)
 *   - cheap    → tiny free model for titles / memory / math helpers
 */

const COOLDOWN_MS = 60_000;
const TIMEOUT_MS = 60_000;
const MAX_NUMBERED = 20;
const THINKING_CHAR_LIMIT = 4000;

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
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Free-model chains. `openrouter/free` (auto router) is always last resort. */
export const CHAINS = {
  coding: [
    'poolside/laguna-m.1:free',
    'poolside/laguna-xs-2.1:free',
    'cohere/north-mini-code:free',
    'openrouter/free',
  ],
  thinking: [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'openai/gpt-oss-20b:free',
    'openrouter/free',
  ],
  balanced: [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'openai/gpt-oss-20b:free',
    'openrouter/free',
  ],
  cheap: [
    'openai/gpt-oss-20b:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'openrouter/free',
  ],
};

/** The model list the UI shows, per tier. Labels are display-only. */
export const MODEL_CATALOG = {
  coding: [
    { id: 'poolside/laguna-m.1:free', label: 'Laguna M.1 · best free coder', default: true },
    { id: 'poolside/laguna-xs-2.1:free', label: 'Laguna XS 2.1 · fast coder' },
    { id: 'cohere/north-mini-code:free', label: 'North Mini Code' },
  ],
  thinking: [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra · deepest', default: true },
    { id: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B' },
    { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B' },
  ],
  balanced: [
    { id: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B · balanced', default: true },
    { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B · quick' },
  ],
};

const ALLOWED_MODELS = new Set(
  Object.values(MODEL_CATALOG).flat().map((m) => m.id).concat(['openrouter/free']),
);

export function isAllowedModel(id) {
  return ALLOWED_MODELS.has(id);
}

function last4(key) {
  return key.length > 4 ? key.slice(-4) : '****';
}

function truncate(text, limit) {
  if (!text || text.length <= limit) return text || '';
  return text.slice(0, limit) + '… (truncated)';
}

/**
 * One attempt against OpenRouter with a single key.
 * Returns { ok, text, thinking, retryable }.
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
    if (res.status === 429 || res.status >= 500) return { ok: false, retryable: true };
    if (!res.ok) return { ok: false, retryable: false };
    const json = await res.json().catch(() => ({}));
    const message = json.choices?.[0]?.message;
    const text = (message?.content || '').trim();
    if (!text) return { ok: false, retryable: true };
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
    return { ok: true, text, thinking };
  } catch {
    return { ok: false, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Route across the chain × key pool. First success wins.
 * onAttempt({ model, keyLast4, ok }) feeds logs / analytics.
 */
export async function route(chain, messages, { wantThinking = false, extra = {}, onAttempt = null } = {}) {
  const keys = PROVIDER_POOLS.openrouter().filter((k) => (health.get(k) || 0) < Date.now());
  if (!keys.length) throw new Error('No OpenRouter keys configured (set OPENROUTER_1 … in Vercel).');
  const errors = [];
  for (const model of chain) {
    for (const key of keys) {
      const r = await attempt(key, model, messages, wantThinking, extra);
      if (onAttempt) {
        try { onAttempt({ model, keyLast4: last4(key), ok: r.ok }); } catch {}
      }
      if (r.ok) return { text: r.text, thinking: r.thinking || '', model };
      if (r.retryable) {
        health.set(key, Date.now() + COOLDOWN_MS);
        errors.push(`${model}: retryable`);
      } else {
        errors.push(`${model}: rejected`);
        break; // config-level failure — don't burn the other keys on it
      }
    }
  }
  throw new Error(`All providers failed: ${errors.join('; ')}`);
}

/** Resolve which chain + pinned model to use for a chat request. */
export function resolveChain({ model, thinking } = {}) {
  if (model && isAllowedModel(model)) return { chain: [model, ...CHAINS.balanced.filter((m) => m !== model)], pinned: model };
  if (thinking) return { chain: CHAINS.thinking, pinned: null };
  return { chain: CHAINS.balanced, pinned: null };
}

/** Coding default: best free coding model first. */
export function codingChain() {
  return CHAINS.coding;
}
