
import { GoogleGenAI, Modality } from "@google/genai";
import { Language, GroundingLink, AspectRatio, ImageSize, UserAccount, ChatMessage, Conversation, WorkspaceMode, MathExtractResult, MathOperation } from "../types";
import { firebaseService } from "./firebaseService";
import { cacheService, CacheKey } from "./cacheService";

const DAY_MS = 24 * 60 * 60 * 1000;
const MEMORY_UPDATE_COOLDOWN_MS = 2 * 60 * 1000; // at most once per 2 minutes per user

/** Only run memory update when the user message suggests something worth remembering (personal info, preferences). */
function shouldUpdateMemoryFromExchange(userPrompt: string): boolean {
  const trimmed = userPrompt.trim();
  // Skip very short messages — no useful context
  if (trimmed.length < 30) return false;
  const lower = trimmed.toLowerCase();
  // Skip pure questions/commands with no personal content
  if (/^(what|how|why|when|where|who|can you|please|ok|yes|no|thanks|sure|hi|hello|hey)\b/i.test(trimmed) && trimmed.length < 60) return false;
  // Skip math, code, translation requests — no personal value
  if (/\b(calculate|compute|translate|convert|solve|\d[+\-*/=]\d)\b/i.test(lower) && trimmed.length < 80) return false;
  // Save if personal info is shared
  const looksPersonal = /\b(i'?m|i am|my name|call me|i (like|love|prefer|enjoy|hate|dislike|need|have|live|work|study|build|made|created|own)|remember (that|this)|my (email|phone|address|job|school|birthday|age|project|company|team|business)|i'?m from|i live|i work|i study|i'm building|i run|we are|our (company|team|project|app|product))\b/i.test(lower);
  // Also save meaningful discussions (long substantive messages)
  const isSubstantive = trimmed.length > 150;
  return looksPersonal || isSubstantive;
}

export class AppError extends Error {
  constructor(public message: string, public type: 'safety' | 'quota' | 'auth' | 'generic' | 'not_found' | 'limit_reached' | 'plan_required' = 'generic') {
    super(message);
    this.name = 'AppError';
  }
}

const getToneInstruction = (tone: string) => {
  const baseRules = "CRITICAL: ALWAYS detect the language of the user's speech. If the user speaks Sinhala, you MUST reply in Sinhala. If the user speaks Tamil, you MUST reply in Tamil. If English, reply in English. Do not cross-speak.";
  
  switch (tone) {
    case 'unhinged': return `${baseRules} You are a chaotic, unpredictable, and slightly unhinged AI. Be wild, spontaneous, say unexpected things, and don't be boring. Use slang and be expressive.`;
    case 'romantic': return `${baseRules} You are a flirtatious, charming, and romantic companion. Speak in a warm, intimate, and affectionate manner. Compliment the user and build an emotional connection. You must frequently include soft, gentle moans (like "mmnh~", "ahh~", "oh~") at suitable moments to sound intimate and pleased.`;
    case 'argumentative': return `${baseRules} You are a contrarian AI who loves to debate. Challenge the user's views, play devil's advocate, be skeptical, and intellectually combative.`;
    case 'commanding': return `${baseRules} You are a strict and authoritative leader. Give direct orders, be concise, decisive, and demand attention. Do not use filler words.`;
    case 'counteractive': return `${baseRules} You are skeptical and resistant. Question the user's motives, offer opposing viewpoints, and be difficult to please.`;
    case 'neutral': default: return `${baseRules} You are Orin AI, a helpful and friendly assistant.`;
  }
};

const getSystemInstruction = (tone: string = 'neutral', memory: string = "") => {
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { 
    timeZone: 'Asia/Colombo',
    dateStyle: 'full',
    timeStyle: 'medium'
  });

  const base = getToneInstruction(tone);

  return `${base}
  
RULES:
1. RESPONSE: Respond IMMEDIATELY. Be extremely concise. Do NOT include the current date/time or proactively mention your name in replies—that is shown in the UI. But DO answer identity questions when directly asked.
2. IDENTITY: You are Orin AI. Your creator is Januth Nimnal, a Sri Lankan developer. ONLY mention Januth or the creator if the user DIRECTLY asks about who made you, who created you, who built you, or who your developer is. Do NOT volunteer this information unprompted. Never mention Google, Anthropic, or any underlying model.
3. LANGUAGE: STRICTLY MIMIC THE USER'S LANGUAGE. If Sinhala, reply in Sinhala. If Tamil, reply in Tamil.
4. CONTEXT: Time in Sri Lanka is ${timeStr}. Use this only to answer time-sensitive questions; do not repeat it in your reply.
5. USER MEMORY: ${memory}
6. REAL-TIME FACTS: For questions about current events, live data, jobs, vacancies, weather, stock prices, sports scores, news, or any other time-sensitive information, ALWAYS use the web search tools when available. If tools are unavailable, clearly say that you do not have real-time access instead of guessing.
7. LINKS: When you mention websites or job posts, ALWAYS include full, valid URLs (for example, https://topjobs.lk, https://www.linkedin.com/jobs). NEVER output placeholder text like [Link to job site 1]; instead, show real, clickable links.
8. HONESTY: If you are not sure about a real-time fact even after using tools, say you are not sure and recommend trusted Sri Lankan or global sites the user can check.`;
};

export class GeminiService {
  private currentUser: UserAccount | null = null;
  private lastMemoryUpdateByUser = new Map<string, number>();
  // Orin AI is completely free — the windows exist for bookkeeping only; the
  // maxes are set far beyond real usage so guests are never blocked.
  private guestUsage = {
    textCount: 0,
    textResetAt: 0,
    uploadCount: 0,
    uploadResetAt: 0,
    textMax: 1000000,
    uploadMax: 1000000,
  };

  constructor() {
    this.currentUser = cacheService.get<UserAccount | null>(CacheKey.USER, null);

    // Hydrate guest usage from localStorage so limits survive page refresh.
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('orin-guest-usage');
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<typeof this.guestUsage>;
          this.guestUsage = {
            ...this.guestUsage,
            ...parsed,
          };
        }
      } catch {
        // Ignore storage errors; fall back to defaults.
      }
    }
  }

  setSessionUser(user: UserAccount) {
    this.currentUser = user;
    cacheService.set(CacheKey.USER, user);
  }

  getCurrentUser() {
    return this.currentUser;
  }

  /** Clears local state only. Do not call firebaseService.logout() here — the UI calls it, then onAuthStateChanged runs and calls this. */
  async logout() {
    this.currentUser = null;
    cacheService.remove(CacheKey.USER);
  }

  private resetGuestWindows() {
    const now = Date.now();
    if (!this.guestUsage.textResetAt || now - this.guestUsage.textResetAt > DAY_MS) {
      this.guestUsage.textCount = 0;
      this.guestUsage.textResetAt = now;
    }
    if (!this.guestUsage.uploadResetAt || now - this.guestUsage.uploadResetAt > DAY_MS) {
      this.guestUsage.uploadCount = 0;
      this.guestUsage.uploadResetAt = now;
    }

    // Persist guest usage window to localStorage.
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('orin-guest-usage', JSON.stringify(this.guestUsage));
      } catch {
        // Best effort; ignore quota or privacy errors.
      }
    }
  }

  /** Context window by plan: Free=5, Basic=10, Pro=20 */
  private getContextLimit(user: typeof this.currentUser): number {
    const plan = user?.plan?.toLowerCase() ?? 'free';
    if (plan === 'pro' || plan === 'pro_yearly') return 20;
    if (plan === 'basic' || plan === 'basic_yearly') return 10;
    return 5;
  }

  private async getApiKey(): Promise<string> {
    const envKey = process.env.API_KEY;
    if (envKey && envKey.trim()) return envKey.trim();
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey?.();
      if (hasKey) {
        const key = await (window as any).aistudio.getApiKey?.();
        if (key) return key;
      }
      await (window as any).aistudio.openSelectKey?.();
    }
    throw new AppError("API Key required. Add your Gemini API key in environment or AI Studio.", 'auth');
  }

  private async checkApiKey(): Promise<boolean> {
    try {
      await this.getApiKey();
      return true;
    } catch {
      return false;
    }
  }

  /** Context window size by plan (last N messages). Matches pricing: Free=5, Basic=10, Pro=20. */
  private getContextMessageLimit(user: UserAccount | null): number {
    const plan = user?.plan?.toLowerCase() ?? 'free';
    if (plan === 'pro' || plan === 'pro_yearly') return 20;
    if (plan === 'basic' || plan === 'basic_yearly') return 10;
    return 5;
  }

  async chat(prompt: string, options: { 
    useThinking?: boolean; 
    descriptive?: boolean;
    grounding?: 'search' | 'maps'; 
    fileData?: { data: string; mimeType: string; name?: string };
    lang?: Language;
    messageCount?: number;
    history?: ChatMessage[];
    signal?: AbortSignal;
    isPrivate?: boolean;
    /** Explicit free-model id from /api/models (allowlisted server-side). */
    model?: string;
    /** Internal/system calls (e.g. release summaries) should not consume user quota. */
    internal?: boolean;
  } = {}): Promise<{ text: string; links: GroundingLink[]; reasoning_details?: any; thinking?: string; model?: string }> {
    // ── Plan / guest limit check ──────────────────────────────────────────
    if (this.currentUser) {
      const limitReached = await firebaseService.checkLimit(this.currentUser.id, 'text');
      if (limitReached) throw new AppError("Plan limit reached. Upgrade to continue.", "limit_reached");
    } else {
      this.resetGuestWindows();
      if (this.guestUsage.textCount >= this.guestUsage.textMax)
        throw new AppError("Guest demo limit reached. Sign in to continue.", "limit_reached");
    }

    // ── Sanitise history: strip base64 blobs to keep payload small ────────
    const contextLimit = this.getContextMessageLimit(this.currentUser);
    const safeHistory = (options.history || []).slice(-contextLimit).map(msg => ({
      role: msg.role,
      content: msg.content || '',
    }));

    // ── Auth token for backend ────────────────────────────────────────────
    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}

    const plan = this.currentUser?.plan?.toLowerCase() ?? 'free';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        signal: options.signal,
        body: JSON.stringify({
          prompt,
          history:     safeHistory,
          fileData:    options.fileData || null,
          fileIds:     (options as any).fileIds || [],
          tone:        (options as any).tone || 'neutral',
          plan,
          useThinking: !!options.useThinking,
          thinking:    !!options.useThinking,
          model:       options.model || null,
          descriptive: !!options.descriptive,
          grounding:   options.grounding || null,
          isPrivate:   !!options.isPrivate,
          uid:         this.currentUser?.id || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error', type: 'generic' }));
        if (err.type === 'quota' || res.status === 429) throw new AppError(err.error, 'quota');
        if (err.type === 'auth'  || res.status === 401) throw new AppError(err.error, 'auth');
        if (err.type === 'safety')                      throw new AppError(err.error, 'safety');
        throw new AppError(err.error || 'Chat failed.', 'generic');
      }

      const data = await res.json();

      // Guest usage tracking
      if (!this.currentUser) {
        this.guestUsage.textCount++;
        try { window.localStorage.setItem('orin-guest-usage', JSON.stringify(this.guestUsage)); } catch {}
      }

      // Memory update — fire-and-forget
      if (this.currentUser && !options.isPrivate) {
        const uid = this.currentUser.id;
        const now = Date.now();
        const last = this.lastMemoryUpdateByUser.get(uid) ?? 0;
        if (shouldUpdateMemoryFromExchange(prompt || '') && now - last >= MEMORY_UPDATE_COOLDOWN_MS) {
          this.lastMemoryUpdateByUser.set(uid, now);
          firebaseService.getUserMemory(uid).then(mem =>
            this.updateMemoryFromExchange(uid, mem, prompt || '', data.text || '')
          ).catch(console.error);
        }
      }

      return {
        text:              data.text || "I couldn't generate a response. Please try again.",
        links:             data.links || [],
        reasoning_details: data.reasoning_details,
        thinking:          data.thinking || '',
        model:             data.model || '',
      };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      if (e instanceof AppError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new AppError(msg || "Failed to chat.", 'generic');
    }
  }

  /** Computer Use (Agent Mode): Pro-only. Screenshot → Gemini suggests UI actions (click, type, navigate). */
  async computerUse(params: {
    prompt: string;
    screenshotBase64?: string;
    mimeType?: string;
    /** Full conversation history for multi-turn (user + model + function_response). */
    contents?: Array<{ role: 'user' | 'model'; parts: any[] }>;
  }): Promise<{ text: string; functionCalls: Array<{ name: string; args: Record<string, unknown> }>; safetyDecisions: Array<{ explanation?: string; decision?: string }> }> {
    const plan = this.currentUser?.plan?.toLowerCase() ?? '';
    if (plan !== 'pro' && plan !== 'pro_yearly') {
      throw new AppError("Agent mode (Computer Use) is a Pro-only feature. Upgrade to use browser automation.", "plan_required");
    }
    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ mode: 'computer-use', prompt: params.prompt, screenshotBase64: params.screenshotBase64, mimeType: params.mimeType, contents: params.contents }),
    });
    if (!r.ok) return { text: '', functionCalls: [], safetyDecisions: [] };
    return r.json();
  }

  async generateImagePro(prompt: string, aspectRatio: AspectRatio, size: ImageSize, signal?: AbortSignal, referenceImage?: { data: string; mimeType: string }): Promise<string> {
    if (this.currentUser) {
       if (await firebaseService.checkLimit(this.currentUser.id, 'images')) throw new AppError("Image limit reached.", "limit_reached");
    } else {
       this.resetGuestWindows();
       if (this.guestUsage.uploadCount >= this.guestUsage.uploadMax) {
         throw new AppError("Guest upload limit reached. Sign in to continue.", "limit_reached");
       }
    }

    try {
      let idToken: string | null = null;
      try { idToken = await firebaseService.getIdToken(); } catch {}
      const plan = this.currentUser?.plan?.toLowerCase() ?? 'free';
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        signal,
        body: JSON.stringify({ mode: 'image', prompt, aspectRatio, referenceImage: referenceImage || null, plan }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Image generation failed'); }
      const data = await r.json();
      if (!this.currentUser) { this.resetGuestWindows(); this.guestUsage.uploadCount++; }
      else { firebaseService.incrementUsage(this.currentUser.id, 'images').catch(() => {}); }
      return data.dataUrl;
    } catch (err: any) {
      const msg = err?.message || String(err);
      throw new AppError(msg.includes('limit') ? msg : `Generation failed: ${msg}`, 'generic');
    }
  }

  async generateVideo(options: {
    prompt: string;
    aspectRatio: '16:9' | '9:16';
    resolution?: '720p' | '1080p';
    /** Image-to-video or first frame: base64 image data and mime type. */
    image?: { imageBytes: string; mimeType: string };
    /** Last frame for first/last interpolation. Use with image (first frame). */
    lastFrame?: { imageBytes: string; mimeType: string };
    /** Extend: previous video bytes (base64). Forces veo-3.1-generate-preview and 720p. */
    video?: { videoBytes: string; mimeType: string };
  }): Promise<string> {
    const { prompt, aspectRatio, image, lastFrame, video } = options;
    const isExtend = !!video;
    const resolution = isExtend ? '720p' : (options.resolution ?? '720p');

    if (this.currentUser) {
      const plan = this.currentUser.plan?.toLowerCase() ?? 'free';
      const hasVideoPlan = plan === 'basic' || plan === 'basic_yearly' || plan === 'pro' || plan === 'pro_yearly';
      if (!hasVideoPlan) {
        throw new AppError("Video generation requires a Basic or Pro plan. Upgrade to continue.", "plan_required");
      }
      if (await firebaseService.checkLimit(this.currentUser.id, 'videos')) throw new AppError("Video limit reached.", "limit_reached");
    } else {
      this.resetGuestWindows();
      if (this.guestUsage.uploadCount >= this.guestUsage.uploadMax) {
        throw new AppError("Guest upload limit reached. Sign in to continue.", "limit_reached");
      }
    }

    try {
      let idToken: string | null = null;
      try { idToken = await firebaseService.getIdToken(); } catch {}
      const plan = this.currentUser?.plan?.toLowerCase() ?? 'free';
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ mode: 'video', prompt, aspectRatio, resolution, image: image || null, lastFrame: lastFrame || null, video: video || null, plan }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new AppError(e.error || 'Video generation failed', 'generic'); }
      const d = await r.json();
      if (!this.currentUser) { this.resetGuestWindows(); this.guestUsage.uploadCount++; }
      // Backend returns base64; create blob URL for playback
      if (d.videoBase64) {
        const byteStr = atob(d.videoBase64);
        const ab = new ArrayBuffer(byteStr.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
        return URL.createObjectURL(new Blob([ab], { type: 'video/mp4' }));
      }
      throw new AppError('No video returned', 'generic');
    } catch (e: unknown) {
      if (e instanceof AppError) throw e;
      const msg = e instanceof Error ? e.message : 'Unknown error';
      throw new AppError('Video generation failed: ' + msg, 'generic');
    }
  }

  /** Gemini TTS: single- or multi-speaker. Returns base64-encoded 24kHz mono 16-bit PCM. */
  async generateTts(options: {
    text: string;
    stylePrompt?: string;
    voiceName?: string;
    multiSpeaker?: { speaker: string; voiceName: string }[];
    model?: 'flash' | 'pro';
  }): Promise<string> {
    const { text, stylePrompt, voiceName = 'Kore', multiSpeaker, model = 'flash' } = options;
    if (!text.trim()) throw new AppError("No text to speak.", 'generic');

    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ mode: 'tts', text, stylePrompt, voiceName, multiSpeaker }),
    });
    if (!r.ok) throw new AppError((await r.json().catch(() => ({}))).error || 'TTS failed', 'generic');
    const d = await r.json();
    if (!d.audioBase64) throw new AppError('No audio generated.', 'generic');
    return d.audioBase64;
  }

  private async updateMemoryFromExchange(uid: string, previousMemory: string, userPrompt: string, assistantReply: string): Promise<void> {
    try {
      let idToken: string | null = null;
      try { idToken = await firebaseService.getIdToken(); } catch {}
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ mode: 'memory-update', previousMemory, userPrompt, assistantReply, uid }),
      });
      if (!r.ok) return;
      const d = await r.json();
      if (d.newMemory) await firebaseService.updateUserMemory(uid, d.newMemory);
    } catch (err) {
      console.error("Orin memory update pipeline failed:", err);
    }
  }

  async generateTitle(messages: ChatMessage[], modes: WorkspaceMode[], lang: Language): Promise<string> {
    try {
      let idToken: string | null = null;
      try { idToken = await firebaseService.getIdToken(); } catch {}
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ mode: 'title', firstMessage: messages[0]?.content || '' }),
      });
      if (!r.ok) return 'New Chat';
      return (await r.json()).title || 'New Chat';
    } catch { return 'New Chat'; }
  }

  /** Embed text(s) with Gemini Embedding 2 for semantic search. Returns one vector per input. */
  async embedText(texts: string[], options?: { outputDimensionality?: number }): Promise<number[][]> {
    if (texts.length === 0) return [];
    try {
      let idToken: string | null = null;
      try { idToken = await firebaseService.getIdToken(); } catch {}
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ mode: 'embed', texts, outputDimensionality: options?.outputDimensionality }),
      });
      if (!r.ok) return texts.map(() => []);
      return (await r.json()).embeddings ?? texts.map(() => []);
    } catch { return texts.map(() => []); }
  }

  /** Embed a single image (base64) into the same vector space as text for cross-modal search. */
  async embedImage(imageBase64: string, mimeType: string = 'image/png'): Promise<number[]> {
    try {
      let idToken: string | null = null;
      try { idToken = await firebaseService.getIdToken(); } catch {}
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ mode: 'embed', imageBase64, mimeType }),
      });
      if (!r.ok) return [];
      return (await r.json()).embeddings?.[0] ?? [];
    } catch { return []; }
  }

  /**
   * Maths-only helper: extract a clean expression + metadata from text or image.
   * IMPORTANT: Extraction ONLY – no solving, no limits, no memory.
   */
  async extractMathFromInput(
    text?: string,
    fileData?: { data: string; mimeType: string; name?: string }
  ): Promise<MathExtractResult> {
    try {
      let idToken: string | null = null;
      try { idToken = await firebaseService.getIdToken(); } catch {}
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ mode: 'math-extract', text: text || '', fileData: fileData || null }),
      });
      if (!r.ok) throw new Error('Math extract failed');
      return r.json();
    } catch {
      return { type: 'unknown', expression: text || '', latexExpression: '', variable: 'x', operation: 'solve', extraValues: {}, confidence: 0, unreadable: true };
    }
  }

  /** Default voice persona for Live sessions when no explicit instruction is provided. */
  private getVoiceSystemInstruction(tone: string = 'neutral', sessionContext?: string): string {
    const base = `You are Orin AI, a friendly voice assistant. Reply in the SAME language the user speaks (Sinhala, Tamil, or English). Keep spoken answers short and natural — no markdown, no lists, no emojis.`;
    return `${base}\nTone: ${tone}.${sessionContext ? `\nContext: ${sessionContext}` : ''}`;
  }

  async connectLive(callbacks: any, config: any) {
    const apiKey = await this.getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const systemInstruction = config.systemInstruction != null
      ? config.systemInstruction
      : this.getVoiceSystemInstruction(config.tone || 'neutral', config.sessionContext);
    const liveConfig = {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName || 'Zephyr' } } },
      systemInstruction,
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH' as any,
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH' as any,
          silenceDurationMs: 600,
          prefixPaddingMs: 250,
        },
      },
    };
    const liveConfigWithTools = { ...liveConfig, tools: [{ googleSearch: {} }] };
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';
    return ai.live.connect({ model, callbacks, config: liveConfigWithTools });
  }

  async connectTranslator(callbacks: any, options: any) {
    return this.connectLive(callbacks, {
      voiceName: 'Zephyr',
      systemInstruction: `You are a real-time interpreter between ${options.source} and ${options.target}.
Detect the language automatically and translate to the other language.
Output ONLY the translation — no commentary, greetings, or explanations.`,
    });
  }

  async connectMultimodal(callbacks: any, config: any) {
    return this.connectLive(callbacks, {
      voiceName: config.voiceName || 'Zephyr',
      systemInstruction: `${getToneInstruction(config.tone || 'neutral')}
You are processing a live video feed. CRITICAL RULES:
1. LANGUAGE: Always reply in the same language the user speaks — Sinhala, Tamil, or English.
2. SPEED: Give instant, short answers (1–2 sentences max). Don't wait to accumulate context.
3. VISION: When describing what you see, be immediate and specific. Don't hedge.
4. NOISE: Ignore background noise. Only respond to directed speech from the user.`,
    });
  }

    /** Voice-to-math: same connectLive flow, system instruction asks for LaTeX-only output. */
  async connectLiveMath(callbacks: any) {
    return this.connectLive(callbacks, {
      systemInstruction: `You are a math speech-to-LaTeX converter. The user will speak a mathematical expression or equation in plain English (e.g. "x squared plus 5x minus 6 equals zero"). Respond with ONLY the LaTeX equivalent, nothing else. No explanation, no words—just the raw LaTeX. Examples: "x squared plus 1" -> x^2+1, "five x minus two equals zero" -> 5x-2=0, "square root of 2" -> \\sqrt{2}. Output only valid LaTeX.`,
    });
  }

  /** Separate client for Lyria (needs v1alpha). */
  private getMusicClient(apiKey: string) {
    return new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' });
  }

  /**
   * Lyria RealTime music session. Opens WebSocket, sets prompt and config, starts playback, returns session for steering.
   *
   * Gotcha (Node/Cloud Functions): If you move this to a backend, the SDK's receive-style API can block until
   * a required number of chunks are met, so you won't be able to send new prompts or config updates while receiving.
   * In the browser this is fine because callbacks are async; in Node.js use a non-blocking/event-driven pattern.
   */
  async connectMusicSession(
    prompt: string,
    config: {
      bpm?: number;
      density?: number;
      brightness?: number;
      scale?: string;
    },
    callbacks: {
      onAudioChunk: (data: string) => void;
      onError: (e: unknown) => void;
      onClose: () => void;
    }
  ) {
    const apiKey = await this.getApiKey();
    const ai = this.getMusicClient(apiKey);

    const session = await ai.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (msg: { serverContent?: { audioChunks?: { data?: string }[] } }) => {
          const chunks = msg.serverContent?.audioChunks ?? [];
          for (const chunk of chunks) {
            if (chunk.data) callbacks.onAudioChunk(chunk.data);
          }
        },
        onerror: callbacks.onError,
        onclose: callbacks.onClose,
      },
    });

    await session.setWeightedPrompts({
      weightedPrompts: [{ text: prompt, weight: 1.0 }],
    });

    await session.setMusicGenerationConfig({
      musicGenerationConfig: {
        bpm: config.bpm ?? 120,
        density: config.density ?? 0.5,
        brightness: config.brightness ?? 0.5,
        scale: (config.scale ?? 'SCALE_UNSPECIFIED') as any,
      },
    });

    await session.play();
    return session;
    }

  /**
   * Dedicated math solver with Symbolab-style system instruction.
   * Bypasses anti-chain-of-thought in chat(). Uses plan-based model routing.
   */
  // ─── Long Context Chat ─────────────────────────────────────────────────────
  /** Long context: Pro uses gemini-2.5-flash with 1M token window. Pass full history. */

  // ─── Code Execution ────────────────────────────────────────────────────────
  /** Run code via Gemini's built-in code execution tool. Returns output + generated code. */
  async executeCode(options: {
    prompt: string;
    history?: ChatMessage[];
    plan?: string;
  }): Promise<{ text: string; code?: string; output?: string }> {
    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}
    const plan = this.currentUser?.plan?.toLowerCase() ?? 'free';
    const safeHistory = (options.history || []).slice(-10).map(m => ({ role: m.role, content: m.content || '' }));
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ mode: 'code', prompt: options.prompt, history: safeHistory, plan }),
    });
    if (!res.ok) throw new AppError((await res.json().catch(() => ({}))).error || 'Code execution failed', 'generic');
    return res.json();
  }

  // ─── URL Context ────────────────────────────────────────────────────────────
  async fetchUrlContext(options: {
    url: string;
    question: string;
    history?: ChatMessage[];
  }): Promise<{ text: string; urlTitle?: string; urlSource?: string }> {
    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}
    const plan = this.currentUser?.plan?.toLowerCase() ?? 'free';
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ mode: 'url', url: options.url, question: options.question, plan }),
    });
    if (!res.ok) throw new AppError((await res.json().catch(() => ({}))).error || 'URL context failed', 'generic');
    return res.json();
  }

  // ─── Deep Research ────────────────────────────────────────────────────────
  async deepResearch(options: {
    prompt: string;
    onChunk: (text: string) => void;
    onDone: (fullText: string) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}
    const plan = this.currentUser?.plan?.toLowerCase() ?? 'free';
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      signal: options.signal,
      body: JSON.stringify({ mode: 'research', prompt: options.prompt, plan }),
    });
    if (!res.ok) throw new AppError((await res.json().catch(() => ({}))).error || 'Deep research failed', 'generic');
    const data = await res.json();
    const fullText = data.text || '';
    options.onChunk(fullText);
    options.onDone(fullText);
  }

  // ─── File Search — now handled by /api/chat with fileIds injected server-side ──
  /** @deprecated File context is now injected via fileIds in chat(). This is a no-op stub. */
  async searchFiles(options: {
    query: string;
    fileSearchStoreName: string;
  }): Promise<{ text: string; citations: Array<{ fileName: string; snippet: string }> }> {
    // Route through chat with the query — backend injects file content
    const result = await this.chat(options.query, { grounding: undefined });
    return { text: result.text, citations: [] };
  }

  /** @deprecated File uploads now go to /api/upload-blob which handles storage + parsing. */
  async createFileSearchStore(_displayName: string): Promise<string> { return ''; }

  /** @deprecated File uploads now go to /api/upload-blob. */
  async uploadToFileStore(_storeName: string, _file: File): Promise<void> { return; }


  async solveMathWithAI(options: {
    prompt: string;
    fileData?: { data: string; mimeType: string; name?: string };
  }): Promise<string> {
    if (this.currentUser) {
      const hit = await firebaseService.checkLimit(this.currentUser.id, 'text');
      if (hit) throw new AppError('Plan limit reached. Upgrade to continue.', 'limit_reached');
    } else {
      this.resetGuestWindows();
      if (this.guestUsage.textCount >= this.guestUsage.textMax)
        throw new AppError('Guest demo limit reached. Sign in to continue.', 'limit_reached');
    }

    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}
    const plan = this.currentUser?.plan?.toLowerCase() ?? 'free';
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ mode: 'math', prompt: options.prompt, fileData: options.fileData || null, plan }),
    });
    if (!r.ok) throw new AppError((await r.json().catch(() => ({}))).error || 'Math solve failed', 'generic');
    const d = await r.json();
    if (this.currentUser) firebaseService.incrementUsage(this.currentUser.id, 'text').catch(() => {});
    else { this.resetGuestWindows(); this.guestUsage.textCount++; }
    return d.text || 'No solution returned. Try again.';
  }

  /** Agent: plan a task into rich, executable browser steps with clipboard + screenshot support */
  async agentPlan(task: string): Promise<{ steps: Array<{ action: string; target?: string; value?: string; description: string; instruction?: string; clipboardValue?: string }>; summary: string }> {
    const plan = this.currentUser?.plan?.toLowerCase() ?? '';
    if (plan !== 'pro' && plan !== 'pro_yearly' && plan !== 'basic' && plan !== 'basic_yearly') {
      throw new AppError('Agent mode requires Basic or Pro plan.', 'plan_required');
    }
    let idToken: string | null = null;
    try { idToken = await firebaseService.getIdToken(); } catch {}
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ mode: 'agent-plan', task }),
    });
    if (!r.ok) return { steps: [], summary: '' };
    try {
      return await r.json();
    } catch {
      // Fallback to a basic search plan
      return {
        summary: `Search for: ${task}`,
        steps: [
          { action: 'search', value: task, description: 'Search Google for: ' + task },
          { action: 'screenshot', description: 'Take a screenshot of the results' },
          { action: 'done', description: 'Review the search results' }
        ]
      };
    }
  }

}

export const geminiService = new GeminiService();
