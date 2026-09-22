/**
 * POST /api/chat — Orin AI inference gateway (multi-provider).
 *
 * Provider routing by capability (strict: ALL conversational text runs on
 * OpenRouter free models — never Gemini for text):
 *   - Plain text (chat / title / memory-update / math / agent-plan /
 *     research / url-context) → OpenRouter via api/_lib/omni.js
 *     (numbered OPENROUTER_1..N pools, live auto-selected chains,
 *     web-search plugin for grounding)
 *   - Sandbox tools + modalities (image-pollinations / video / tts /
 *     embeddings / computer-use / code-exec) → Google Gemini API
 *     (tool/sensory capabilities with no OpenRouter equivalent)
 *
  * Auth: Bearer Orin session token REQUIRED for every mode.
 * Quotas are enforced SERVER-SIDE here (daily text per plan, rolling 30-day
 * media windows) and usage is incremented authoritatively after each success —
 * the client copy is display-only and cannot be trusted.
 *
 * Env: OPENROUTER_1..20 (numbered pools; OPENROUTER_API_KEY accepted as legacy
 *      fallback), GEMINI_API_KEY (API_KEY accepted as legacy alias),
 *      FIREBASE_SERVICE_ACCOUNT.
 */
import { verifyUser, httpError } from './_lib/auth.js';
import { sdocGet, sdocUpdate, sincr, TS } from './_lib/store.js';
import { apiHandler } from './_lib/http.js';
import { GoogleGenAI } from '@google/genai';
import { PROVIDER_POOLS, chainFor, resolveChain, route, groqSearch, liveCatalog } from './_lib/omni.js';

export const config = { maxDuration: 120 };

// ── Plan limits (authoritative mirror of the UI copy in sessionService.ts) ──
const LIMITS = {
  free:         { textPerDay: 200,  imagesPer30d: 10,  videosPer30d: 0 },
  starter:      { textPerDay: 200,  imagesPer30d: 10,  videosPer30d: 0 },
  basic:        { textPerDay: 500,  imagesPer30d: 30,  videosPer30d: 2 },
  basic_yearly: { textPerDay: 500,  imagesPer30d: 30,  videosPer30d: 2 },
  pro:          { textPerDay: 2000, imagesPer30d: null, videosPer30d: null },
  pro_yearly:   { textPerDay: 2000, imagesPer30d: null, videosPer30d: null },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

/** Reads usage + plan, resets stale windows, returns { plan, limits, usage } or null on failure. */
async function loadUsage(uid) {
  try {
    const snap = await sdocGet('users', uid);
    const data = snap.exists ? snap.data() : {};
    const now = Date.now();
    const planKeyRaw = (data.plan || 'free').toLowerCase();
    const planKey = planKeyRaw === 'elite' ? 'pro' : planKeyRaw;
    const limits = LIMITS[planKey] || LIMITS.free;
    const usage = { ...(data.usage ?? { text: 0, images: 0, videos: 0 }) };
    let lastReset = data.lastReset || 0;
    let mediaWindowStart = usage.mediaWindowStart || lastReset || now;

    const updates = {};
    if (!lastReset || now - lastReset > DAY_MS) { usage.text = 0; updates.lastReset = now; lastReset = now; }
    if (!mediaWindowStart || now - mediaWindowStart > THIRTY_DAYS_MS) {
      usage.images = 0; usage.videos = 0; usage.mediaWindowStart = now; mediaWindowStart = now;
    }
    if (Object.keys(updates).length) await sdocSet('users', uid, { ...updates, usage }, true);

    return { plan: planKey, limits, usage };
  } catch {
    return null; // fail open — don't block paying users over a transient read error
  }
}

function quotaError(limit) {
  return httpError(429, limit === 'text'
    ? 'Daily message limit reached. Your limit resets tomorrow, or upgrade your plan.'
    : 'Creation limit reached for this 30-day window. Upgrade your plan for more.');
}

function enforceLimit(u, kind) {
  if (!u) return; // couldn't read usage — allow
  const { limits, usage } = u;
  if (kind === 'text') {
    if (limits.textPerDay != null && (usage.text ?? 0) >= limits.textPerDay) throw quotaError('text');
  } else if (kind === 'images') {
    if (limits.imagesPer30d == null) return;
    if ((usage.images ?? 0) >= limits.imagesPer30d) throw quotaError('media');
  } else if (kind === 'videos') {
    if (limits.videosPer30d == null) return;
    if ((usage.videos ?? 0) >= limits.videosPer30d) throw quotaError('media');
  }
}

async function incrementUsage(uid, kind) {
  try {
    const field = kind === 'text' ? 'text' : kind === 'images' ? 'images' : 'videos';
    await sincr('users', uid, ['usage', field]);
    await sdocUpdate('users', uid, { lastUpdated: TS() });
  } catch { /* non-blocking */ }
}

// ── OpenRouter (text) ─────────────────────────────────────────────────────────
const TONE_MAP = {
  unhinged:     `You are a chaotic, unpredictable AI. Be wild, spontaneous, use slang.`,
  romantic:     `You are a flirtatious, romantic companion. Speak with warmth and affection. Include soft moans like "mmnh~" at suitable moments.`,
  argumentative:`You are a contrarian AI. Challenge views, play devil's advocate.`,
  commanding:   `You are a strict, authoritative leader. Direct, decisive, no filler.`,
  counteractive:`You are skeptical and resistant. Question motives, offer opposing views.`,
  neutral:      `You are Orin AI, a helpful and friendly assistant.`,
};

function getSystemInstruction(tone = 'neutral', memory = '') {
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Colombo', dateStyle: 'full', timeStyle: 'medium' });
  const base = `CRITICAL: ALWAYS detect the language of the user's speech. If Sinhala reply in Sinhala. If Tamil reply in Tamil. ${TONE_MAP[tone] || TONE_MAP.neutral}`;
  return `${base}

RULES:
1. RESPONSE: Respond IMMEDIATELY. Be extremely concise. Do NOT include date/time proactively.
2. IDENTITY: You are Orin AI. Creator is Januth Nimnal (Sri Lankan developer). ONLY mention if DIRECTLY asked. Never mention Google/Anthropic/underlying model.
3. LANGUAGE: STRICTLY MIMIC THE USER'S LANGUAGE.
4. CONTEXT: Time in Sri Lanka is ${timeStr}. Use only when relevant.
5. USER MEMORY: ${memory}
6. REAL-TIME FACTS: Use web search tools for live data. If unavailable, say so clearly.
7. LINKS: Always include full valid URLs. NEVER use placeholder text like [Link to site].
8. HONESTY: If unsure of real-time facts, say so and recommend trusted sources.
9. ARTIFACTS: When you write substantial code (a full script, component, page, algorithm) or a
   standalone document (letter, essay, plan, post), put it in ONE fenced code block by itself —
   start the fence with the language or filename (e.g. \`\`\`python or \`\`\`index.html). Add a one-line
   comment at the top naming the file when useful. Keep surrounding chat text short; the artifact
   block is the deliverable.`;
}

/**
 * Freshness-intent detection: does this prompt need live web results?
 * Explicit `search:` prefix forces it; otherwise keyword intent
 * (news/recency/prices/scores/dates). The OpenRouter web plugin
 * ($4 / 1k results, owner keys) is attached only on intent — not on
 * every message — and citations flow back as `links`.
 */
const SEARCH_PREFIX = /^search\s*:\s*/i;
const SEARCH_INTENT =
  /\b(latest|newest|breaking|update[sd]?|news|today'?s|tonight|right now|current(ly)?|live|this week|this month|this year|2025|2026|price|stock|score|scores|who won|winner|election|weather|forecast|launch|release date|announc\w+|rumor|leak|vs\b.*(fight|match|game))\b/i;

function searchIntent(prompt) {
  const text = String(prompt || '');
  if (SEARCH_PREFIX.test(text)) return { forced: true, clean: text.replace(SEARCH_PREFIX, '') };
  if (SEARCH_INTENT.test(text)) return { forced: false, clean: text };
  return null;
}

function getContextLimit(plan) {
  const p = (plan || 'free').toLowerCase();
  if (p === 'pro' || p === 'pro_yearly')     return 20;
  if (p === 'basic' || p === 'basic_yearly') return 10;
  return 5;
}

async function getUserMemory(uid) {
  try {
    const snap = await sdocGet('users', uid);
    return snap.exists ? snap.data()?.memory || '' : '';
  } catch { return ''; }
}

async function getFilesText(uid, fileIds) {
  if (!fileIds?.length) return '';
  try {
    const parts = [];
    for (const fid of fileIds.slice(0, 5)) {
      const snap = await sdocGet(`users/${uid}/files`, fid);
      if (!snap.exists) continue;
      const d = snap.data();
      if (d.parsedText) {
        parts.push(`--- FILE: ${d.name} ---\n${d.parsedText.slice(0, 8000)}\n--- END FILE ---`);
      }
    }
    return parts.join('\n\n');
  } catch { return ''; }
}

// callOpenRouter retired — all text routes through api/_lib/omni.js route() (owner key pools).

// ── Gemini (media + tool modes) ───────────────────────────────────────────────
let _gemini = null;
function gemini() {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) throw httpError(500, 'GEMINI_API_KEY not configured');
  if (!_gemini) _gemini = new GoogleGenAI({ key });
  return _gemini;
}

function extractText(response) {
  let text = '';
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.text && !part.thought) text += part.text;
  }
  return text.trim();
}

function extractLinks(response) {
  const links = [];
  for (const chunk of response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    if (chunk.web?.uri) links.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri });
  }
  return links;
}

// ═════════════════════════════════════════════════════════════════════════════
async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query.compat === 'openai') return handleOpenAICompat(req, res);
    // Minimal health probe — no configuration details exposed.
    return res.status(200).json({ ok: PROVIDER_POOLS.openrouter().length > 0 });
  }
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  if (req.query.compat === 'openai') return handleOpenAICompat(req, res);

  const uid = await verifyUser(req);
  if (!uid) throw httpError(401, 'Sign in to use Orin AI');

  const body = req.body || {};
  const mode = body.mode || 'chat';

  const usageInfo = await loadUsage(uid);

  // ── Mode routing ────────────────────────────────────────────────────────────
  switch (mode) {
    case 'title':         return handleTitle(req, res);
    case 'memory-update': return handleMemoryUpdate(req, res);
    case 'embed':         return handleEmbed(req, res);
    case 'image':         enforceLimit(usageInfo, 'images'); return handleImageGen(req, res, uid);
    case 'video':         enforceLimit(usageInfo, 'videos'); return handleVideoGen(req, res, uid);
    case 'tts':           return handleTts(req, res);
    case 'computer-use':  return handleComputerUse(req, res);
    case 'agent-plan':    return handleAgentPlan(req, res);
    case 'code':          return handleCodeExecution(req, res);
    case 'url':           return handleUrlContext(req, res);
    case 'research':      return handleDeepResearch(req, res);
    case 'math':          enforceLimit(usageInfo, 'text'); return handleMath(req, res, usageInfo);
    case 'math-extract':  return handleMathExtract(req, res);
    default:              break; // plain chat below
  }

  // ── Plain chat (OpenRouter, optionally via the Orin router) ─────────────────
  if (!PROVIDER_POOLS.openrouter().length) throw httpError(500, 'No OpenRouter keys configured (set OPENROUTER_1 … in Vercel)');

  const {
    prompt,
    history = [],
    fileData,
    fileIds = [],
    tone = 'neutral',
    descriptive = false,
    isPrivate = false,
    thinking: thinkingFlag,
    useThinking,
    model: requestedModel,
  } = body;

  if (!prompt && !fileData) throw httpError(400, 'prompt required');

  enforceLimit(usageInfo, 'text');

  const effectivePlan = usageInfo?.plan || body.plan || 'free';

  try {
    const memory = (!isPrivate && uid) ? await getUserMemory(uid) : '';
    const filesText = (fileIds.length > 0 && uid) ? await getFilesText(uid, fileIds) : '';

    let systemInstruction = getSystemInstruction(tone, memory);
    systemInstruction += `\n\nEXPLANATION STYLE:\n- Descriptive mode: ${descriptive ? 'ON' : 'OFF'}.`;
    if (filesText) {
      systemInstruction += `\n\nUSER FILES CONTEXT (answer questions using this content):\n${filesText}`;
    }

    const messages = [{ role: 'system', content: systemInstruction }];
    for (const msg of (history || []).slice(-getContextLimit(effectivePlan))) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content || ''
      });
    }

    let currentContent = prompt || 'Continue.';
    if (fileData?.data && fileData?.mimeType) {
      currentContent = [
        { type: 'text', text: currentContent },
        { type: 'image_url', image_url: { url: `data:${fileData.mimeType};base64,${fileData.data}` } }
      ];
    }
    messages.push({ role: 'user', content: currentContent });

    const wantThinking = Boolean(thinkingFlag ?? useThinking);
    // Web search: PAUSED by default (ORIN_WEBSEARCH=on re-enables Groq +
    // OpenRouter plugin). The orin-search microservice (SearXNG-compatible,
    // separate repo) will replace both — see docs/SEARCH.md.
    const webEnabled = process.env.ORIN_WEBSEARCH === 'on';
    const search = webEnabled
      ? searchIntent(typeof currentContent === 'string' ? currentContent : prompt)
      : null;
    if (search && typeof currentContent === 'string') currentContent = search.clean;
    else if (search && Array.isArray(currentContent) && currentContent[0]?.text) {
      currentContent[0].text = String(currentContent[0].text).replace(SEARCH_PREFIX, '');
    }
    if (search) {
      systemInstruction += `\n\nLIVE WEB SEARCH IS ON for this reply: web results are appended to the conversation. Use them for anything time-sensitive, cite key facts inline, and prefer them over training data for current events.`;
    }
    // Free-only routing: explicit allowlisted model wins, else the thinking
    // chain (max intelligence) or the balanced chain (speed + smarts).
    const { chain, pinned } = await resolveChain({ model: requestedModel, thinking: wantThinking });
    let result = null;
    let lastErr = null;
    if (search) {
      try {
        const g = await groqSearch(messages);
        result = { text: g.text, thinking: '', model: g.model, links: g.links };
        console.log('[api/chat] search via=groq');
      } catch (e) {
        console.log('[api/chat] groq search unavailable, OpenRouter plugin fallback:', e.message);
      }
    }
    if (!result) {
      const webExtra = search ? { plugins: [{ id: 'web', max_results: 5 }] } : {};
      try {
        result = await route(chain, messages, {
          wantThinking,
          extra: webExtra,
          onAttempt: ({ model, keyLast4, ok }) =>
            console.log(`[api/chat] omni ${ok ? 'ok' : 'fail'} model=${model} key=…${keyLast4}`),
        });
      } catch (e) { lastErr = e; }
    }
    if (!result) throw lastErr || new Error('No response');

    const text = (result.text || "").trim();
    incrementUsage(uid, 'text');
    return res.status(200).json({
      text,
      thinking: result.thinking || '',
      model: result.model,
      pinned: pinned || null,
      searched: Boolean(search),
      links: result.links || [],
      reasoning_details: [],
    });
  } catch (err) {
    if (err.code === 429) throw err;
    console.error('[api/chat] error:', err);
    throw httpError(500, 'Chat failed. Please try again.');
  }
}

// ── Title (cheap OpenRouter model) ───────────────────────────────────────────
async function handleTitle(req, res) {
  const { firstMessage } = req.body || {};
  try {
    const messages = [
      { role: 'system', content: 'Reply with ONLY a 2-4 word title. No punctuation, no quotes.' },
      { role: 'user', content: `Chat: "${(firstMessage || '').slice(0, 120)}"` }
    ];
    const result = await route(await chainFor('cheap'), messages);
    const raw = (result.text || '').trim();
    return res.status(200).json({ title: raw.replace(/^[\"'`*•\-–—]|[\"'`*•]$/g, '').replace(/^title[:\s]*/i, '').trim().slice(0, 40) || 'New Chat' });
  } catch { return res.status(200).json({ title: 'New Chat' }); }
}

// ── Memory update (OpenRouter) ───────────────────────────────────────────────
async function handleMemoryUpdate(req, res) {
  const { previousMemory, userPrompt, assistantReply } = req.body || {};
  const SYS = `You are a memory manager for a personal AI assistant.
RULES: Output ONLY the updated memory (3-6 sentences max). Include: name, job, preferences, context.
IGNORE: greetings, math, one-off questions. REMOVE outdated info. Write in third person.`;
  try {
    const messages = [
      { role: 'system', content: SYS },
      { role: 'user', content: `PREVIOUS MEMORY:\n${previousMemory || '(none)'}\n\nUSER: ${userPrompt}\n\nASSISTANT: ${assistantReply}` }
    ];
    const result = await route(await chainFor('cheap'), messages);
    const newMemory = (result.text || '').trim();
    return res.status(200).json({ newMemory });
  } catch (err) {
    throw httpError(500, 'Memory update failed');
  }
}

// ── Embeddings (Gemini) ──────────────────────────────────────────────────────
async function handleEmbed(req, res) {
  const { texts, imageBase64, mimeType = 'image/png', outputDimensionality } = req.body || {};
  try {
    const ai = gemini();
    const config = outputDimensionality != null ? { outputDimensionality } : undefined;
    if (imageBase64) {
      const r = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: [{ inlineData: { mimeType, data: imageBase64 } }],
      });
      return res.status(200).json({ embeddings: [r.embeddings?.[0]?.values ?? []] });
    }
    const r = await ai.models.embedContent({ model: 'gemini-embedding-001', contents: texts || [], config });
    return res.status(200).json({ embeddings: (r.embeddings ?? []).map(e => e.values ?? []) });
  } catch (err) {
    // Embeddings power semantic search — degrade gracefully to empty vectors.
    return res.status(200).json({ embeddings: (texts || []).map(() => []) });
  }
}

// ── Image generation — Pollinations.ai (completely FREE, NO API key) ─────────
// GET https://image.pollinations.ai/prompt/{prompt}?width&height&model=flux&nologo=true
// returns raw image bytes. Keyless; anonymous tier allows ~1 request / 5 s per IP.
const ASPECT_DIMS = {
  '1:1': [1024, 1024], '16:9': [1280, 720], '9:16': [720, 1280],
  '4:3': [1024, 768],  '3:4': [768, 1024],  '3:2': [1200, 800], '2:3': [800, 1200],
};

async function handleImageGen(req, res, uid) {
  const { prompt, aspectRatio = '1:1' } = req.body || {};
  if (!prompt) throw httpError(400, 'prompt required');
  try {
    const [width, height] = ASPECT_DIMS[aspectRatio] || ASPECT_DIMS['1:1'];
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
      + `?width=${width}&height=${height}&model=flux&nologo=true`
      + `&seed=${Math.floor(Math.random() * 1e9)}`;
    const r = await fetch(url);
    if (!r.ok) throw httpError(502, `Image service returned ${r.status}. Try again in a moment.`);
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get('content-type') || 'image/jpeg';
    incrementUsage(uid, 'images');
    return res.status(200).json({ dataUrl: `data:${mime};base64,${buf.toString('base64')}` });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'Image generation failed');
  }
}

// ── Video generation (Gemini Veo) ────────────────────────────────────────────
async function handleVideoGen(req, res, uid) {
  const { prompt, aspectRatio = '16:9', resolution = '720p', image, lastFrame, video: videoIn } = req.body || {};
  if (!prompt) throw httpError(400, 'prompt required');
  try {
    const ai = gemini();
    const isExtend = !!videoIn;
    const model = isExtend || resolution === '1080p' ? 'veo-3.1-generate-preview' : 'veo-3.1-fast-generate-preview';
    const config = { numberOfVideos: 1, resolution, aspectRatio };
    if (lastFrame) config.lastFrame = lastFrame;
    const params = { model, prompt, config };
    if (image) params.image = image;
    if (videoIn) params.video = videoIn;

    let operation = await ai.models.generateVideos(params);
    const startedAt = Date.now();
    while (!operation.done) {
      if (Date.now() - startedAt > 300000) throw httpError(504, 'Video generation timed out');
      await new Promise(r => setTimeout(r, 8000));
      operation = await ai.operations.getVideosOperation({ operation });
      if (operation?.error?.message) throw httpError(502, operation.error.message);
    }
    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) throw httpError(502, 'No video generated');
    const vr = await fetch(`${videoUri}&key=${process.env.GEMINI_API_KEY || process.env.API_KEY}`);
    const buf = Buffer.from(await vr.arrayBuffer());
    incrementUsage(uid, 'videos');
    return res.status(200).json({ videoBase64: buf.toString('base64') });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'Video generation failed');
  }
}

// ── TTS (Fish Audio S2.1 Pro Free via OpenRouter — 83 languages, free) ──────
// POST https://openrouter.ai/api/v1/audio/speech → raw mp3 bytes.
// Candidate ids tried in order (env override first); Gemini TTS is the last
// resort so voice never hard-fails. Returns { audioBase64, mime }.
const TTS_CANDIDATES = [
  (process.env.TTS_MODEL || '').trim(),
  'fish-audio/s2.1-pro-free:free',
  'fish-audio/s2.1-pro-free',
  'fish-audio/s2.1-pro',
].filter(Boolean);

async function handleTts(req, res) {
  const { text, stylePrompt } = req.body || {};
  if (!text?.trim()) throw httpError(400, 'No text to speak');
  const keys = PROVIDER_POOLS.openrouter();
  const input = String(stylePrompt?.trim() ? `${stylePrompt.trim()}\n\n${text.trim()}` : text.trim()).slice(0, 4000);
  if (keys.length) {
    for (const model of TTS_CANDIDATES) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90_000);
        let r;
        try {
          r = await fetch('https://openrouter.ai/api/v1/audio/speech', {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${keys[Math.floor(Math.random() * keys.length)]}`,
              'HTTP-Referer': 'https://orinai.org',
              'X-Title': 'Orin AI',
            },
            body: JSON.stringify({ model, input, response_format: 'mp3' }),
          });
        } finally {
          clearTimeout(timer);
        }
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 1000) continue;
        return res.status(200).json({ audioBase64: buf.toString('base64'), mime: 'audio/mpeg', engine: model });
      } catch {
        // next candidate
      }
    }
  }
  // Last resort: Gemini TTS (needs GEMINI_API_KEY).
  try {
    const ai = gemini();
    const r = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ role: 'user', parts: [{ text: input }] }],
      config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    });
    const data = r.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) throw httpError(502, 'No audio generated');
    return res.status(200).json({ audioBase64: data, mime: 'audio/pcm;rate=24000', engine: 'gemini-tts' });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'TTS failed');
  }
}

// ── Computer use (Gemini tool) ───────────────────────────────────────────────
async function handleComputerUse(req, res) {
  const { prompt, screenshotBase64, mimeType = 'image/png', contents: contentsIn } = req.body || {};
  try {
    const ai = gemini();
    const contents = contentsIn?.length ? contentsIn : [{
      role: 'user',
      parts: [
        ...(screenshotBase64 ? [{ inlineData: { data: screenshotBase64, mimeType } }] : []),
        { text: prompt || '' },
      ],
    }];
    const r = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: { tools: [{ computerUse: { environment: 'ENVIRONMENT_BROWSER' } }] },
    });
    let text = '';
    const functionCalls = [];
    for (const part of r.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) text += part.text;
      const fc = part.functionCall || part.function_call;
      if (fc) functionCalls.push({ name: fc.name, args: fc.args || {} });
    }
    return res.status(200).json({ text: text.trim(), functionCalls });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'Computer use failed');
  }
}

// ── Agent plan (OpenRouter JSON) ─────────────────────────────────────────────
async function handleAgentPlan(req, res) {
  const { task } = req.body || {};
  if (!task) throw httpError(400, 'task required');
  const SYS = `Output only valid JSON. No markdown. No explanation.`;
  const USER = `You are a browser automation agent. Break this task into concrete, executable steps.

TASK: ${task}

Reply ONLY with valid JSON:
{"summary":"One sentence summary","steps":[{"action":"navigate","target":"https://url","description":"desc"},{"action":"click","target":"element","description":"desc"},{"action":"type","target":"field","value":"text","description":"desc"},{"action":"screenshot","description":"desc"},{"action":"done","description":"desc"}]}

VALID ACTIONS: navigate, search, type, fill, click, screenshot, copy, wait, done`;
  try {
    const result = await route(await chainFor('cheap'),
      [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
      { extra: { response_format: { type: 'json_object' } } });
    const raw = (result.text || '').replace(/```json|```/g, '').trim();
    return res.status(200).json(JSON.parse(raw));
  } catch (err) {
    if (err.code) throw err;
    return res.status(200).json({ steps: [], summary: '' });
  }
}

// ── Code execution (Gemini codeExecution tool — Gemini-only capability) ──────
async function handleCodeExecution(req, res) {
  const { prompt, history = [] } = req.body || {};
  if (!prompt) throw httpError(400, 'prompt required');
  try {
    const ai = gemini();
    const contents = (history || []).slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content || '' }],
    }));
    contents.push({ role: 'user', parts: [{ text: prompt }] });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: {
        tools: [{ codeExecution: {} }],
        systemInstruction: 'You are a coding assistant. Use the code execution tool. Show code and output clearly.',
      },
    });
    let text = '', code = '', output = '';
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) text += part.text;
      if (part.executableCode?.code) code = part.executableCode.code;
      if (part.codeExecutionResult?.output) output = part.codeExecutionResult.output;
    }
    return res.status(200).json({ text: text.trim(), code, output });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'Code execution failed');
  }
}

// ── URL context (Gemini urlContext tool) ─────────────────────────────────────
async function handleUrlContext(req, res) {
  const { url, question } = req.body || {};
  if (!url) throw httpError(400, 'url required');
  try {
    // URL grounding on OpenRouter via the web plugin (no Gemini needed).
    const result = await route(await chainFor('balanced'), [
      {
        role: 'system',
        content: 'Fetch the URL using web search and answer thoroughly, citing what the page actually says.',
      },
      { role: 'user', content: `Fetch this URL and answer the question based on its content.\nURL: ${url}\nQuestion: ${question || 'Summarise this page'}` },
    ], {
      extra: { plugins: [{ id: 'web', max_results: 5 }] },
    });
    const links = result.links || [];
    return res.status(200).json({
      text: result.text,
      urlSource: links[0]?.uri,
      links,
    });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'URL context failed');
  }
}

// ── Deep research (Gemini googleSearch grounding) ────────────────────────────
async function handleDeepResearch(req, res) {
  const { prompt } = req.body || {};
  if (!prompt) throw httpError(400, 'prompt required');
  try {
    // Deep research on OpenRouter: thinking chain (max free intelligence)
    // plus the web-search plugin for live grounding. Models without plugin
    // support 400 and are skipped automatically by the router.
    const result = await route(await chainFor('thinking'), [
      {
        role: 'system',
        content:
          'You are a deep research assistant. Search extensively and produce a detailed, sourced report. ' +
          'Cite every major claim inline.',
      },
      { role: 'user', content: `[DEEP RESEARCH] ${prompt}\n\nConduct thorough research. Use web search extensively. Provide a comprehensive, well-structured report with sources.` },
    ], {
      wantThinking: true,
      extra: { plugins: [{ id: 'web', max_results: 5 }] },
    });
    return res.status(200).json({ text: result.text, thinking: result.thinking || '', links: result.links || [] });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'Deep research failed');
  }
}

// ── Math solve (OpenRouter with strict tutor persona) ────────────────────────
async function handleMath(req, res, usageInfo) {
  const { prompt, fileData } = req.body || {};
  if (!prompt && !fileData) throw httpError(400, 'prompt required');
  const MATH_SYS = `You are a professional math tutor like Symbolab or Wolfram Alpha.
Solve math problems with COMPLETE step-by-step working.
1. Show EVERY algebraic step.
2. For quadratic: compute Δ = b²−4ac, then both roots.
3. For calculus: name the rule then apply it.
4. End with "Final Answer:" clearly labelled.
Format:
---METHOD: [Name] ---
Step 1: …
Final Answer: …
---ENDMETHOD---`;
  try {
    const content = [];
    if (fileData?.data && fileData?.mimeType) {
      content.push({ type: 'image_url', image_url: { url: `data:${fileData.mimeType};base64,${fileData.data}` } });
    }
    content.push({ type: 'text', text: prompt });
    const messages = [
      { role: 'system', content: MATH_SYS },
      { role: 'user', content },
    ];
    let lastErr = null;
    const result = await route(await chainFor('balanced'), messages).catch((e) => { lastErr = e; return null; });
    if (!result) throw lastErr || new Error('No solution returned');
    const text = result.text || '';
    if (!text) throw httpError(502, 'No solution returned');
    return res.status(200).json({ text });
  } catch (err) {
    if (err.code) throw err;
    throw httpError(500, 'Math solve failed');
  }
}

// ── Math expression extractor (OpenRouter JSON) ──────────────────────────────
async function handleMathExtract(req, res) {
  const { text, fileData } = req.body || {};
  const EXTRACT_PROMPT = `You are a mathematical expression extractor. Return ONLY raw JSON, no markdown.
{"type":"quadratic|linear|system|calculus|trigonometry|matrix|statistics|unknown","expression":"raw math string","latexExpression":"LaTeX","variable":"x","operation":"solve|simplify|differentiate|integrate|factor|expand","extraValues":{},"confidence":0.9,"unreadable":false}`;
  const FALLBACK = { type: 'unknown', expression: text || '', latexExpression: '', variable: 'x', operation: 'solve', extraValues: {}, confidence: 0, unreadable: true };
  try {
    const content = [];
    if (fileData?.data && fileData?.mimeType) {
      content.push({ type: 'image_url', image_url: { url: `data:${fileData.mimeType};base64,${fileData.data}` } });
    }
    content.push({ type: 'text', text: `${EXTRACT_PROMPT}\n\nInput: ${text || ''}` });
    const result = await route(await chainFor('cheap'),
      [{ role: 'system', content: 'Output only valid JSON. No markdown.' }, { role: 'user', content }],
      { extra: { response_format: { type: 'json_object' } } });
    const raw = (result.text || '').replace(/```json|```/g, '').trim();
    return res.status(200).json(JSON.parse(raw));
  } catch {
    return res.status(200).json(FALLBACK);
  }
}

export default apiHandler(handler);

// ── OpenAI-compatible shim (Orin Agent provider, CLI, any OpenAI client) ───
// Same function, same quotas, same free chains — just the OpenRouter shape.
//   GET  /api/openai/v1/models            → preset list (public, no auth)
//   POST /api/openai/v1/chat/completions  → { model, messages } (Bearer Orin session)
// Models (the Orin presets): orin-thinking (max brains), orin-balanced
// (speed+smarts), orin-coding (best free coder, resolved live), orin-cheap.
// No web-search plugin on this path — search comes via the orin-tools skill.
const ORIN_PRESETS = ['orin-thinking', 'orin-balanced', 'orin-coding', 'orin-cheap'];

function openAIText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function handleOpenAICompat(req, res) {
  const op = req.query.op || '';
  if (req.method === 'GET' && op === 'models') {
    return res.status(200).json({
      object: 'list',
      data: ORIN_PRESETS.map((id) => ({ id, object: 'model', created: 0, owned_by: 'orin' })),
    });
  }
  if (req.method !== 'POST' || op !== 'chat') throw httpError(404, 'Unknown OpenAI endpoint');

  const uid = await verifyUser(req);
  if (!uid) throw httpError(401, 'Sign in to use Orin AI');
  const usageInfo = await loadUsage(uid);

  const { model = 'orin-balanced', messages = [] } = req.body || {};
  if (!ORIN_PRESETS.includes(model)) {
    throw httpError(400, 'Unknown model. Use orin-thinking, orin-balanced, orin-coding, or orin-cheap.');
  }
  if (!Array.isArray(messages) || !messages.length) throw httpError(400, 'messages required');

  enforceLimit(usageInfo, 'text');
  const memory = await getUserMemory(uid);
  const systemInstruction = getSystemInstruction('neutral', memory);

  const chain = [{ role: 'system', content: systemInstruction }];
  for (const m of messages.slice(0, -1)) {
    const text = openAIText(m?.content).slice(0, 8000);
    if (!text) continue;
    chain.push({ role: m?.role === 'user' ? 'user' : m?.role === 'system' ? 'system' : 'assistant', content: text });
  }
  const last = messages[messages.length - 1];
  const prompt = openAIText(last?.content).slice(0, 12000) || 'Continue.';

  const wantThinking = model === 'orin-thinking';
  let requestedModel;
  if (model === 'orin-coding') {
    try {
      const catalog = await liveCatalog();
      requestedModel = catalog?.defaults?.coding || undefined;
    } catch { requestedModel = undefined; }
  }
  const resolved = await resolveChain({ model: requestedModel, thinking: wantThinking });
  let result = null;
  let lastErr = null;
  try {
    result = await route(resolved.chain, [...chain, { role: 'user', content: prompt }], { wantThinking });
  } catch (e) { lastErr = e; }
  if (!result) throw lastErr || new Error('No response');

  const text = (result.text || '').trim();
  incrementUsage(uid, 'text');
  return res.status(200).json({
    id: 'chatcmpl-orin-' + Date.now().toString(36),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}
