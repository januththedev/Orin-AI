/**
 * Voice mode — zero API keys required.
 *
 * Talk loop (all on-device except the two server calls):
 *   mic (Web Speech recognition, en/si/ta) → Orin chat (fast balanced
 *   chain, short spoken-style answers) → Fish Audio voice reply.
 *
 * Translator mode: speak in language A → translated text + voice in B.
 * No Gemini, no Live API, nothing but the OpenRouter + Groq keys the
 * server already has. Unsupported browsers (no SpeechRecognition) get a
 * clear note instead of a dead button.
 */
import React, { useEffect, useRef, useState } from 'react';
import { geminiService } from '../services/geminiService';
import { Language } from '../types';

interface VoiceAssistantProps {
  onClose: () => void;
  lang: Language;
  /** Open directly in live-translate mode. */
  initialMode?: VoiceMode;
}

type VoiceMode = 'assistant' | 'translator';

const LANGS = [
  { code: 'en', label: 'English', speech: 'en-US' },
  { code: 'si', label: 'Sinhala', speech: 'si-LK' },
  { code: 'ta', label: 'Tamil', speech: 'ta-LK' },
] as const;

type Recog = any;

function getRecognizer(): (new () => Recog) | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

interface Turn {
  id: string;
  who: 'you' | 'orin';
  text: string;
}

const VoiceAssistant: React.FC<VoiceAssistantProps> = ({ onClose, lang, initialMode }) => {
  const [mode, setMode] = useState<VoiceMode>(initialMode ?? 'assistant');
  const [langA, setLangA] = useState<string>('en');
  const [langB, setLangB] = useState<string>('si');
  const [listening, setListening] = useState(false);
  const [working, setWorking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recogRef = useRef<Recog | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supported = getRecognizer() !== null;

  const speechLang = (code: string) => LANGS.find((l) => l.code === code)?.speech || 'en-US';
  const langLabel = (code: string) => LANGS.find((l) => l.code === code)?.label || code;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length]);

  useEffect(() => () => {
    try { recogRef.current?.abort(); } catch {}
    try { audioRef.current?.pause(); } catch {}
  }, []);

  const stopAudio = () => {
    try { audioRef.current?.pause(); } catch {}
    audioRef.current = null;
    setSpeaking(false);
  };

  async function playVoice(text: string) {
    if (muted) return;
    stopAudio();
    // Keep spoken replies snappy: first ~1200 chars (TTS latency scales with length).
    const clip = text.replace(/[*_`#>\[\]()]/g, '').slice(0, 1200);
    if (!clip.trim()) return;
    setSpeaking(true);
    try {
      const { audioBase64, mime, mode } = await geminiService.generateTts({ text: clip });
      if (mode === 'browser') { setSpeaking(false); return; }
      const audio = new Audio(`data:${mime};base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }

  async function answer(text: string) {
    setWorking(true);
    setError(null);
    try {
      let prompt: string;
      if (mode === 'translator') {
        prompt = `Translate the following ${langLabel(langA)} text into ${langLabel(langB)}. Reply with ONLY the translation, nothing else:\n\n${text}`;
      } else {
        prompt = text;
      }
      const res = await geminiService.chat(prompt, {
        useThinking: false,
        descriptive: false,
        ...(mode === 'assistant'
          ? { history: [{ id: 'sys', role: 'user', content: 'Keep every reply short and speakable: under 60 words, no markdown, no lists, no emojis.' } as any] }
          : {}),
      });
      const reply = (res.text || '').trim() || "Sorry, I didn't catch that.";
      const id = Date.now().toString();
      setTurns((prev) => [...prev, { id, who: 'orin', text: reply }]);
      await playVoice(reply);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Try again.');
    } finally {
      setWorking(false);
    }
  }

  const toggleListen = () => {
    if (listening) {
      try { recogRef.current?.stop(); } catch {}
      return;
    }
    const Ctor = getRecognizer();
    if (!Ctor) {
      setError('Voice input needs Chrome or Edge on this device.');
      return;
    }
    stopAudio();
    setError(null);
    const recog = new Ctor();
    recogRef.current = recog;
    recog.lang = speechLang(mode === 'translator' ? langA : lang);
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript || '';
      setListening(false);
      if (transcript.trim()) {
        setTurns((prev) => [...prev, { id: Date.now().toString(), who: 'you', text: transcript.trim() }]);
        void answer(transcript.trim());
      }
    };
    recog.onerror = () => setListening(false);
    recog.onend = () => setListening(false);
    try {
      recog.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative bg-stone-50 dark:bg-[#0d0b09]">
      {/* Header */}
      <header className="shrink-0 h-16 flex items-center justify-between px-5 md:px-8 border-b border-black/[0.05] dark:border-white/[0.05] bg-white/70 dark:bg-stone-900/60 backdrop-blur sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-br from-cyan-400 to-sky-500 shadow-sm shadow-cyan-500/50" aria-hidden />
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-stone-800 dark:text-white">
            {mode === 'translator' ? 'Live translate' : 'Voice mode'}
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex p-0.5 rounded-xl bg-stone-200/60 dark:bg-stone-800">
            {(['assistant', 'translator'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); stopAudio(); try { recogRef.current?.abort(); } catch {} setListening(false); }}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${mode === m ? 'bg-white dark:bg-stone-700 text-cyan-600 dark:text-cyan-300 shadow-sm' : 'text-stone-400'}`}>
                {m === 'assistant' ? 'Talk' : 'Translate'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center text-stone-400 hover:text-red-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors" aria-label="Back">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </header>

      {/* Language pickers */}
      <div className="shrink-0 px-5 md:px-8 pt-3 flex items-center gap-2">
        {mode === 'translator' ? (
          <>
            <select value={langA} onChange={(e) => setLangA(e.target.value)} aria-label="Speak in"
              className="flex-1 px-3 py-2.5 rounded-2xl bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] text-xs font-bold text-stone-700 dark:text-stone-200 outline-none">
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <i className="fa-solid fa-arrow-right text-stone-400 text-xs" aria-hidden />
            <select value={langB} onChange={(e) => setLangB(e.target.value)} aria-label="Hear in"
              className="flex-1 px-3 py-2.5 rounded-2xl bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] text-xs font-bold text-stone-700 dark:text-stone-200 outline-none">
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </>
        ) : (
          <p className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
            Speak in {langLabel(lang)} — answers come back spoken too.
          </p>
        )}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 md:px-8 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {turns.length === 0 && !listening && !working && (
            <div className="min-h-[40vh] flex flex-col items-center justify-center text-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/40 to-violet-500/30 blur-3xl rounded-full scale-150" aria-hidden />
                <div className="relative w-20 h-20 rounded-[26px] bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/10 shadow-xl flex items-center justify-center">
                  <i className="fa-solid fa-microphone text-2xl text-cyan-500" aria-hidden />
                </div>
              </div>
              <p className="text-sm font-bold text-stone-500 dark:text-stone-400 max-w-xs">
                {supported
                  ? mode === 'translator'
                    ? `Tap the mic, speak ${langLabel(langA)} — hear it in ${langLabel(langB)}.`
                    : 'Tap the mic and just talk. Tap again to send.'
                  : 'Voice input needs Chrome or Edge — chat works everywhere.'}
              </p>
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} className={`flex ${t.who === 'you' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm font-medium shadow-sm ${
                t.who === 'you'
                  ? 'bg-gradient-to-br from-cyan-500 to-sky-600 text-white rounded-br-md'
                  : 'bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 border border-black/[0.05] dark:border-white/[0.06] rounded-bl-md'
              }`}>
                {t.text}
              </div>
            </div>
          ))}
          {(listening || working || speaking) && (
            <div className="flex items-center gap-2 px-1">
              <span className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`w-1.5 h-1.5 rounded-full animate-bounce ${listening ? 'bg-red-500' : working ? 'bg-cyan-500' : 'bg-violet-500'}`} style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
              <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">
                {listening ? 'Listening…' : working ? 'Thinking…' : 'Speaking…'}
              </span>
            </div>
          )}
          {error && <p role="status" className="text-xs font-bold text-red-500">{error}</p>}
          <div ref={scrollRef} className="h-1" />
        </div>
      </div>

      {/* Controls */}
      <div className="shrink-0 p-4 md:p-6">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-3">
          <button onClick={() => setMuted((v) => !v)} title={muted ? 'Unmute voice' : 'Mute voice'}
            className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all ${
              muted
                ? 'border-red-500/50 text-red-500 bg-red-500/10'
                : 'border-stone-300/60 dark:border-white/10 text-stone-400 hover:text-stone-700 dark:hover:text-stone-100'
            }`} aria-label="Mute">
            <i className={`fa-solid ${muted ? 'fa-volume-xmark' : 'fa-volume-high'}`} aria-hidden />
          </button>
          <button onClick={toggleListen} disabled={working || speaking || !supported}
            title="Tap to talk"
            className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl transition-all active:scale-95 disabled:opacity-40 ${
              listening
                ? 'bg-red-500 text-white shadow-xl shadow-red-500/40 animate-pulse'
                : 'bg-gradient-to-br from-cyan-500 to-sky-600 text-stone-950 shadow-xl shadow-cyan-500/30 hover:brightness-105'
            }`} aria-label="Talk">
            <i className={`fa-solid ${listening ? 'fa-stop' : 'fa-microphone'}`} aria-hidden />
          </button>
          {(working || speaking) && (
            <button onClick={() => { stopAudio(); }} title="Stop"
              className="w-14 h-14 rounded-full border border-stone-300/60 dark:border-white/10 text-stone-400 hover:text-red-500 flex items-center justify-center transition-all" aria-label="Stop">
              <i className="fa-solid fa-stop" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceAssistant;
