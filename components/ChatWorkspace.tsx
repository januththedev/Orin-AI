
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { geminiService, AppError } from '../services/geminiService';
import { ChatMessage, Language, AspectRatio } from '../types';
import ArtifactPanel, { Artifact } from './ArtifactPanel';

/** Fenced blocks big enough to be worth opening as an artifact (Claude-style). */
function extractArtifacts(content: string): Artifact[] {
  const out: Artifact[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const info = m[1].trim();
    const code = m[2];
    const lines = code.split('\n');
    if (lines.length < 12 && code.length < 600) continue;
    // Info string doubles as a filename when it looks like one (e.g. index.html).
    const looksFile = /\.[a-z0-9]{1,5}$/i.test(info);
    const firstLine = (lines.find(l => l.trim()) || '').trim();
    const title = looksFile ? info : `${info || 'text'} snippet`;
    out.push({ title, language: looksFile ? info.split('.').pop()! : info || 'text', code });
    void firstLine;
  }
  return out;
}

interface ChatWorkspaceProps {
  onOpenSidebar: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  lang: Language;
  activeConvId: string;
  onUpdateTitle: (title: string) => void;
  /** Prompt handed over from the landing page — fills the composer once. */
  seedPrompt?: string;
  onSeedConsumed?: () => void;
  isSyncing?: boolean;
  thinkingMode: boolean;
  descriptiveMode: boolean;
  onReasoningModeChange: (opts: { thinking?: boolean; descriptive?: boolean }) => void;
}

const IMAGE_ASPECTS: Array<{ id: AspectRatio; label: string }> = [
  { id: '1:1', label: 'Square' },
  { id: '16:9', label: 'Wide' },
  { id: '9:16', label: 'Story' },
  { id: '4:3', label: 'Classic' },
];

const STARTERS = [
  'Explain black holes like I am ten',
  'Write a short poem about Kandy in the rain',
  'Ideas for a birthday caption in Sinhala',
  'Help me draft a job application email',
];

// ─── Message renderer: markdown-lite + inline URLs as pill buttons ──────────
const URL_RE = /https?:\/\/[^\s)"'<>\]]+/g;

function renderInline(text: string, isUser: boolean): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0].replace(/[.,;:!?)]$/, '');
    const label = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 30); }
    })();
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 mx-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors no-underline
          ${isUser
            ? 'bg-cyan-300/20 text-cyan-100 hover:bg-cyan-300/30 border border-cyan-300/30'
            : 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20'
          }`}>
        <i className="fa-solid fa-link text-[8px]" />
        {label}
        <i className="fa-solid fa-arrow-up-right-from-square text-[8px]" />
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function parseLine(line: string, isUser: boolean, key: number): React.ReactNode {
  const segments: React.ReactNode[] = [];
  const boldRe = /\*\*(.*?)\*\*/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = boldRe.exec(line)) !== null) {
    if (m.index > last) segments.push(...renderInline(line.slice(last, m.index), isUser));
    segments.push(<strong key={m.index}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < line.length) segments.push(...renderInline(line.slice(last), isUser));
  return <React.Fragment key={key}>{segments}</React.Fragment>;
}

const MessageContent: React.FC<{ content: string; isUser: boolean }> = ({ content, isUser }) => {
  const hasSinhala = /[\u0D80-\u0DFF]/.test(content);
  const hasTamil   = /[\u0B80-\u0BFF]/.test(content);
  const langClass  = hasSinhala ? 'sinhala-text' : hasTamil ? 'tamil-text' : '';

  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^#{1,3} /.test(line)) {
      const lvl = (line.match(/^#+/) || [''])[0].length;
      const txt = line.replace(/^#+\s*/, '');
      const cls = lvl === 1 ? 'text-base font-black mt-4 mb-1 text-cyan-600 dark:text-cyan-300'
                : lvl === 2 ? 'text-sm font-black mt-3 mb-1 text-stone-600 dark:text-stone-300'
                : 'text-xs font-black mt-2 mb-0.5 uppercase tracking-wider text-stone-500';
      nodes.push(<p key={i} className={cls}>{renderInline(txt, isUser)}</p>);
    }
    else if (/^[\-\*•] /.test(line)) {
      const txt = line.replace(/^[\-\*•]\s*/, '');
      nodes.push(
        <div key={i} className="flex gap-2 my-0.5">
          <span className="mt-1.5 w-1 h-1 rounded-full bg-current shrink-0 opacity-50" />
          <span>{parseLine(txt, isUser, i)}</span>
        </div>
      );
    }
    else if (/^\d+\.\s/.test(line)) {
      const num = (line.match(/^(\d+)/) || ['',''])[1];
      const txt = line.replace(/^\d+\.\s*/, '');
      nodes.push(
        <div key={i} className="flex gap-2 my-0.5">
          <span className="shrink-0 font-black text-cyan-500 dark:text-cyan-500/80 text-xs mt-1 min-w-[1.4rem] text-right tabular-nums">{num}.</span>
          <span>{parseLine(txt, isUser, i)}</span>
        </div>
      );
    }
    else if (line.trimStart().startsWith('```')) {
      const langName = line.replace(/```/, '').trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={`code-${i}`} className="my-2 p-3 rounded-xl bg-stone-950 border border-white/[0.06] text-emerald-300/90 text-xs overflow-x-auto font-mono leading-relaxed">
          {langName && <div className="text-[9px] font-bold text-stone-500 uppercase mb-1">{langName}</div>}
          {codeLines.join('\n')}
        </pre>
      );
    }
    else if (/^---+$/.test(line.trim())) {
      nodes.push(<hr key={i} className="my-2 border-current opacity-10" />);
    }
    else if (!line.trim()) {
      if (nodes.length > 0) nodes.push(<div key={i} className="h-1.5" />);
    }
    else {
      nodes.push(<p key={i} className="leading-relaxed">{parseLine(line, isUser, i)}</p>);
    }
    i++;
  }

  return (
    <div className={`text-sm md:text-[15px] space-y-0.5 ${langClass}`}>
      {nodes}
    </div>
  );
};

// ─── Generated-image bubble (Pollinations result) ────────────────────────────
const ImageMessage: React.FC<{ msg: ChatMessage }> = ({ msg }) => (
  <figure className="max-w-full md:max-w-md">
    <img
      src={msg.imageUrl}
      alt={msg.content || 'Generated image'}
      className="w-full rounded-2xl border border-black/[0.06] dark:border-white/[0.08] shadow-lg"
      loading="lazy"
    />
    <figcaption className="flex items-center justify-between gap-3 mt-2">
      <span className="text-[11px] text-stone-500 dark:text-stone-400 truncate min-w-0">{msg.content}</span>
      <a
        href={msg.imageUrl}
        download={`orin-image-${msg.id}.jpg`}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/25 transition-colors no-underline"
      >
        <i className="fa-solid fa-download text-[9px]" aria-hidden /> Save
      </a>
    </figcaption>
  </figure>
);

const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  onOpenSidebar, messages, setMessages, lang, activeConvId, onUpdateTitle,
  seedPrompt, onSeedConsumed,
  thinkingMode, descriptiveMode, onReasoningModeChange,
}) => {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [stepLabel, setStepLabel] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [privateMessages, setPrivateMessages] = useState<ChatMessage[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ data: string; mimeType: string; name: string } | null>(null);
  const [imageMode, setImageMode] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>('1:1');
  const [chatError, setChatError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [modelCatalog, setModelCatalog] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [openThinking, setOpenThinking] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentMessages = isPrivate ? privateMessages : messages;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length, isTyping]);

  // Fresh conversation → clear private scratchpad and any stale error state.
  useEffect(() => {
    setPrivateMessages([]);
    setChatError(null);
  }, [activeConvId]);

  // Free-model catalog for the picker (coding tier default = best free coder).
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((data) => {
        const coding = data?.tiers?.coding || [];
        setModelCatalog(coding);
        if (!selectedModel && data?.defaults?.coding) setSelectedModel(data.defaults.coding);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Landing-page handoff: prefill the composer with the seeded prompt once.
  useEffect(() => {
    const p = seedPrompt?.trim();
    if (!p) return;
    setInput(p);
    inputRef.current?.focus();
    onSeedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if ((!text && !selectedFile) || isTyping) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setChatError(null);
    setIsTyping(true);
    setStepLabel(imageMode ? 'Painting your image…' : 'Thinking…');
    setInput('');

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text || '(image)',
      timestamp: new Date(),
      type: selectedFile ? 'image' : 'text',
      imageUrl: selectedFile ? `data:${selectedFile.mimeType};base64,${selectedFile.data}` : undefined,
    };
    if (isPrivate) setPrivateMessages(prev => [...prev, userMsg]);
    else setMessages(prev => [...prev, userMsg]);

    try {
      if (imageMode && !selectedFile) {
        // ── Pollinations image generation (keyless, free) ──────────────────
        const dataUrl = await geminiService.generateImagePro(text, aspect, '1K', controller.signal);
        const botMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: text,
          timestamp: new Date(),
          type: 'image',
          imageUrl: dataUrl,
        };
        if (isPrivate) setPrivateMessages(prev => [...prev, botMsg]);
        else {
          setMessages(prev => [...prev, botMsg]);
          if (messages.length === 0) {
            geminiService.generateTitle([userMsg, botMsg], ['chat'], lang)
              .then(title => onUpdateTitle(title))
              .catch(() => {});
          }
        }
      } else {
        // ── Text chat ──────────────────────────────────────────────────────
        const res = await geminiService.chat(text || 'Describe this.', {
          fileData: selectedFile || undefined,
          useThinking: thinkingMode,
          descriptive: descriptiveMode,
          model: selectedModel || undefined,
          history: isPrivate ? privateMessages : messages,
          signal: controller.signal,
          isPrivate,
        });
        const botMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: res.text,
          timestamp: new Date(),
          type: 'text',
          links: res.links || [],
          thinking: res.thinking || '',
          model: res.model || '',
        };
        if (isPrivate) setPrivateMessages(prev => [...prev, botMsg]);
        else {
          setMessages(prev => [...prev, botMsg]);
          if (messages.length === 0) {
            geminiService.generateTitle([userMsg, botMsg], ['chat'], lang)
              .then(title => onUpdateTitle(title))
              .catch(() => {});
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const appErr = e as AppError;
      const raw = appErr?.message || (e instanceof Error ? e.message : String(e));
      if (/limit/i.test(raw)) setChatError('You are sending messages very fast — give it a moment and try again.');
      else if (/api key/i.test(raw)) setChatError('AI service is not configured yet. Please check back soon.');
      else if (/quota/i.test(raw)) setChatError('The AI service is busy right now. Try again in a moment.');
      else setChatError(raw || 'Something went wrong. Try again.');
    } finally {
      setIsTyping(false);
      setStepLabel('');
      setSelectedFile(null);
    }
  }, [input, selectedFile, isTyping, imageMode, aspect, isPrivate, privateMessages, messages, thinkingMode, descriptiveMode, lang, onUpdateTitle, setMessages]);

  const togglePrivate = () => {
    setIsPrivate(prev => !prev);
    setPrivateMessages([]);
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Slim header */}
      <header className="h-13 shrink-0 flex items-center justify-between gap-2 px-3 md:px-5 py-2.5 border-b border-black/[0.05] dark:border-white/[0.05] bg-white/70 dark:bg-stone-900/60 backdrop-blur z-30">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onOpenSidebar} className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-stone-500 hover:bg-black/5 dark:hover:bg-white/5" aria-label="Open menu">
            <i className="fa-solid fa-bars" />
          </button>
          <h2 className="text-xs font-black uppercase tracking-[0.18em] text-stone-800 dark:text-stone-100 truncate">
            {isPrivate ? 'Private chat' : 'Orin AI'}
          </h2>
          {isPrivate && <i className="fa-solid fa-lock text-[10px] text-cyan-500" aria-hidden />}
        </div>
        <div className="flex items-center gap-1.5">
          {modelCatalog.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              title="Model (free tier)"
              className="px-2 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border border-stone-300/60 dark:border-white/10 text-stone-500 dark:text-stone-300 bg-transparent hover:text-stone-700 dark:hover:text-stone-100 transition-colors max-w-[150px]"
            >
              {modelCatalog.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => onReasoningModeChange({ thinking: !thinkingMode })}
            title="Deeper reasoning"
            aria-pressed={thinkingMode}
            className={`px-2.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-colors ${
              thinkingMode
                ? 'bg-cyan-500 text-stone-950 border-cyan-500'
                : 'border-stone-300/60 dark:border-white/10 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200'
            }`}
          >
            Deep
          </button>
          <button
            onClick={() => onReasoningModeChange({ descriptive: !descriptiveMode })}
            title="More detailed answers"
            aria-pressed={descriptiveMode}
            className={`px-2.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-colors ${
              descriptiveMode
                ? 'bg-cyan-500 text-stone-950 border-cyan-500'
                : 'border-stone-300/60 dark:border-white/10 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200'
            }`}
          >
            Detailed
          </button>
          <button
            onClick={togglePrivate}
            title={isPrivate ? 'Turn off private mode' : 'Private mode — nothing is saved'}
            aria-pressed={isPrivate}
            className={`w-8 h-8 rounded-full flex items-center justify-center border transition-colors ${
              isPrivate
                ? 'bg-cyan-500 text-stone-950 border-cyan-500'
                : 'border-stone-300/60 dark:border-white/10 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200'
            }`}
          >
            <i className={`fa-solid ${isPrivate ? 'fa-user-secret' : 'fa-eye'} text-[11px]`} />
          </button>
        </div>
      </header>

      {/* Message column */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto w-full px-4 pt-6 pb-56 md:pb-64 space-y-5">
          {currentMessages.length === 0 ? (
            <div className="min-h-[55vh] flex flex-col items-center justify-center text-center px-4">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-cyan-500/25 blur-3xl rounded-full scale-150" aria-hidden />
                <img src="/favicon.svg" alt="" className="relative w-16 h-16 drop-shadow-xl" />
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-stone-900 dark:text-white">
                {isPrivate ? 'Private chat' : 'How can I help?'}
              </h1>
              <p className="mt-2 text-sm text-stone-500 dark:text-stone-400 max-w-sm">
                Ask anything, or switch on <span className="font-bold text-cyan-600 dark:text-cyan-300">Image</span> below to create pictures.
              </p>
              {!isPrivate && (
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                  {STARTERS.map(s => (
                    <button
                      key={s}
                      onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      className="text-left px-4 py-3 rounded-2xl bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] text-xs font-semibold text-stone-600 dark:text-stone-300 hover:border-cyan-500/40 hover:text-stone-900 dark:hover:text-white transition-colors shadow-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            currentMessages.map((msg, i) => (
              <div key={msg.id || i} className={`flex flex-col animate-reveal ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Attached / generated images */}
                {msg.role === 'user' && msg.imageUrl && (
                  <img src={msg.imageUrl} alt="" className="max-w-[220px] rounded-2xl border border-black/[0.06] dark:border-white/[0.08] mb-1.5" loading="lazy" />
                )}
                {msg.role === 'assistant' && msg.type === 'image' && msg.imageUrl ? (
                  <ImageMessage msg={msg} />
                ) : (
                  <div className={`max-w-[92%] px-4 py-3 md:px-5 md:py-4 rounded-2xl border ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-cyan-500 to-sky-600 text-white border-transparent rounded-br-md shadow-md shadow-cyan-500/10 font-medium'
                      : 'bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 border-black/[0.05] dark:border-white/[0.06] rounded-bl-md shadow-sm'
                  }`}>
                    <MessageContent content={msg.content} isUser={msg.role === 'user'} />
                    {msg.role === 'assistant' && !!msg.thinking && (
                      <div className="mt-2">
                        <button
                          onClick={() => setOpenThinking((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 transition-colors"
                        >
                          <i className={`fa-solid ${openThinking[msg.id] ? 'fa-chevron-up' : 'fa-chevron-down'} text-[8px]`} aria-hidden />
                          Thinking
                        </button>
                        {openThinking[msg.id] && (
                          <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-stone-500 dark:text-stone-400 border-l-2 border-amber-500/40 pl-2.5">
                            {msg.thinking}
                          </pre>
                        )}
                      </div>
                    )}
                    {msg.role === 'assistant' && (() => {
                      const arts = extractArtifacts(msg.content);
                      if (arts.length === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-2 mt-3 pt-2.5 border-t border-black/[0.06] dark:border-white/[0.08]">
                          {arts.map((a, i) => (
                            <button
                              key={i}
                              onClick={() => setArtifact(a)}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-500/[0.08] hover:bg-cyan-500/[0.16] border border-cyan-500/25 text-cyan-700 dark:text-cyan-300 transition-colors no-underline text-left max-w-full"
                            >
                              <i className="fa-solid fa-file-code text-xs shrink-0" aria-hidden />
                              <span className="min-w-0">
                                <span className="block text-[11px] font-bold truncate">{a.title}</span>
                                <span className="block text-[9px] font-black uppercase tracking-widest opacity-70">
                                  Artifact · {a.code.split('\n').length} lines — click to open
                                </span>
                              </span>
                              <i className="fa-solid fa-chevron-right text-[9px] shrink-0 opacity-60" aria-hidden />
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    {msg.links && msg.links.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-black/[0.06] dark:border-white/[0.08]">
                        {msg.links.slice(0, 5).map((link, j) => (
                          <a key={j} href={link.uri} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-stone-900 dark:bg-white text-white dark:text-stone-900 text-[10px] font-black uppercase tracking-widest no-underline hover:opacity-80 transition-opacity">
                            <span className="truncate max-w-[160px]">{link.title || link.uri}</span>
                            <i className="fa-solid fa-arrow-up-right-from-square text-[9px]" aria-hidden />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {isTyping && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
                <span className="typing-dot w-1.5 h-1.5 bg-cyan-500 rounded-full inline-block" />
                <span className="typing-dot w-1.5 h-1.5 bg-cyan-500 rounded-full inline-block" style={{ animationDelay: '150ms' }} />
                <span className="typing-dot w-1.5 h-1.5 bg-cyan-500 rounded-full inline-block" style={{ animationDelay: '300ms' }} />
                {stepLabel && <span className="ml-2 text-[10px] font-bold text-cyan-600 dark:text-cyan-300 uppercase tracking-widest">{stepLabel}</span>}
              </div>
            </div>
          )}
          <div ref={scrollRef} className="h-2" />
        </div>
      </div>

      {/* Composer */}
      <div className="absolute bottom-0 left-0 right-0 p-3 md:p-5 pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto relative">
          {chatError && (
            <div className="mb-2 flex items-center justify-between gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/25 text-red-700 dark:text-red-300 text-xs font-medium">
              <span>{chatError}</span>
              <button type="button" onClick={() => setChatError(null)} className="shrink-0 p-1 rounded hover:bg-red-500/20" aria-label="Dismiss"><i className="fa-solid fa-xmark" /></button>
            </div>
          )}

          {/* Selected attachment chip */}
          {selectedFile && (
            <div className="mb-2 flex">
              <span className="flex items-center gap-1.5 max-w-[220px] px-3 py-1.5 rounded-full bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-200 text-[10px] font-bold">
                <i className="fa-solid fa-paperclip text-[9px]" />
                <span className="truncate">{selectedFile.name}</span>
                <button type="button" onClick={() => setSelectedFile(null)} className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10" aria-label="Remove attachment"><i className="fa-solid fa-xmark text-[9px]" /></button>
              </span>
            </div>
          )}

          <div className="rounded-[26px] bg-white dark:bg-stone-900 border border-black/[0.07] dark:border-white/[0.08] shadow-xl shadow-black/[0.04] dark:shadow-black/40 p-2 flex flex-col gap-1">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
              }}
              placeholder={imageMode ? 'Describe the image to create…' : isPrivate ? 'Private message — not saved…' : 'Ask Orin anything…'}
              className="resize-none max-h-36 bg-transparent outline-none px-3 pt-2 pb-1 text-[15px] font-medium text-stone-900 dark:text-white placeholder:text-stone-400 dark:placeholder:text-stone-500 custom-scrollbar"
            />
            <div className="flex items-center gap-1.5 px-1 pb-0.5">
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf,.txt" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const MAX_DOC = 20 * 1024 * 1024, MAX_IMG = 10 * 1024 * 1024;
                const lower = file.name.toLowerCase();
                const isDoc = file.type === 'application/pdf' || file.type === 'text/plain' || lower.endsWith('.pdf') || lower.endsWith('.txt');
                if (file.type.startsWith('image/') && file.size > MAX_IMG) { setChatError('Image too large — keep it under 10MB.'); e.target.value=''; return; }
                if (isDoc && file.size > MAX_DOC) { setChatError('Document too large — keep it under 20MB.'); e.target.value=''; return; }
                setChatError(null);
                const r = new FileReader();
                r.onload = () => setSelectedFile({ data: (r.result as string).split(',')[1], mimeType: file.type || (lower.endsWith('.pdf') ? 'application/pdf' : 'text/plain'), name: file.name });
                r.readAsDataURL(file);
                e.target.value = '';
              }} />
              <button onClick={() => fileInputRef.current?.click()} disabled={imageMode} title={imageMode ? 'Not available in image mode' : 'Attach an image or document'}
                className="w-9 h-9 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none" aria-label="Attach file">
                <i className="fa-solid fa-paperclip text-sm" />
              </button>

              {/* Image mode toggle */}
              <button
                type="button"
                onClick={() => setImageMode(v => !v)}
                aria-pressed={imageMode}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${
                  imageMode
                    ? 'bg-cyan-500 text-stone-950 border-cyan-500 shadow-sm shadow-cyan-500/30'
                    : 'border-stone-300/60 dark:border-white/10 text-stone-500 hover:text-stone-800 dark:hover:text-stone-100'
                }`}
              >
                <i className="fa-solid fa-wand-magic-sparkles text-[10px]" aria-hidden /> Image
              </button>

              {imageMode && (
                <select
                  value={aspect}
                  onChange={e => setAspect(e.target.value as AspectRatio)}
                  aria-label="Image shape"
                  className="bg-stone-100 dark:bg-stone-800 border-none rounded-full px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500 outline-none cursor-pointer"
                >
                  {IMAGE_ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              )}

              <span className="flex-1" />

              {isTyping ? (
                <button onClick={() => abortControllerRef.current?.abort()}
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 hover:opacity-85 transition-opacity" aria-label="Stop">
                  <i className="fa-solid fa-stop text-[11px]" />
                </button>
              ) : (
                <button onClick={() => void handleSend()} disabled={!input.trim() && !selectedFile}
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-gradient-to-br from-cyan-500 to-sky-500 text-stone-950 shadow-md shadow-cyan-500/25 hover:brightness-105 active:scale-95 disabled:opacity-30 disabled:shadow-none disabled:active:scale-100 transition-all" aria-label="Send">
                  <i className="fa-solid fa-arrow-up text-sm" />
                </button>
              )}
            </div>
          </div>
          <p className="text-center text-[10px] text-stone-400 dark:text-stone-600 mt-2 select-none">
            Free & unlimited · Text by Orin Cloud · Images by Pollinations
          </p>
        </div>
      </div>

      {/* Private-mode ribbon */}
      {isPrivate && (
        <div className="absolute top-16 left-0 right-0 flex justify-center pointer-events-none z-20">
          <span className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-800 dark:text-cyan-200 text-[10px] font-bold uppercase tracking-wider">
            <i className="fa-solid fa-lock text-[9px]" aria-hidden /> Nothing here is saved
          </span>
        </div>
      )}

      <ArtifactPanel artifact={artifact} onClose={() => setArtifact(null)} />
    </div>
  );
};

export default ChatWorkspace;
