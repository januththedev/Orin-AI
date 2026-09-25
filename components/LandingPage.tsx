import React, { useState } from 'react';
import { Language, UserAccount } from '../types';
import { translations } from '../translations';
import { APP_CONFIG } from '../config';

interface LandingPageProps {
  lang: Language;
  user: UserAccount | null;
  /** Jump into chat, optionally seeding the composer with a prompt. */
  onStartChat: (prompt?: string) => void;
  onLogin: () => void;
}

const SOCIALS = [
  { icon: 'fa-instagram', href: 'https://www.instagram.com/januth10.1/' },
  { icon: 'fa-facebook-f', href: 'https://web.facebook.com/januth10.1/' },
  { icon: 'fa-tiktok', href: 'https://www.tiktok.com/@januth10.1' },
];

const LandingPage: React.FC<LandingPageProps> = ({ lang, user, onStartChat, onLogin }) => {
  const t = translations[lang];
  const [prompt, setPrompt] = useState('');

  const cards = [
    { hash: '#chat', icon: 'fa-comments', title: 'Start chatting', desc: 'Free models while supported, with one secure Orin account.' },
    { hash: '#voice', icon: 'fa-microphone', title: 'Voice', desc: 'Talk to Orin — it listens and speaks back.' },
    { hash: '#translate', icon: 'fa-language', title: 'Live Translate', desc: 'English · Sinhala · Tamil, in real time.' },
    { hash: '#downloads', icon: 'fa-download', title: t.downloads, desc: 'Get the Orin desktop app for Windows.' },
    { hash: '#terms', icon: 'fa-file-contract', title: t.terms, desc: 'The simple rules of using Orin.' },
    { hash: '#privacy', icon: 'fa-shield-halved', title: t.privacy, desc: 'What we store — and what we never do.' },
  ];

  return (
    <div className="min-h-full flex flex-col animate-reveal">
      {/* Top bar */}
      <header className="shrink-0 h-16 flex items-center justify-between px-5 md:px-10 border-b border-black/[0.05] dark:border-white/[0.05] bg-white/70 dark:bg-stone-900/60 backdrop-blur sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="Orin Chat" className="w-8 h-8 drop-shadow" />
            <span className="text-sm font-black tracking-tight text-stone-900 dark:text-white">Orin Chat</span>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <button
              onClick={() => onStartChat()}
              className="px-4 py-2 rounded-full bg-gradient-to-br from-cyan-500 to-sky-600 text-white text-[10px] font-black uppercase tracking-widest shadow-md shadow-cyan-500/20 hover:brightness-105 transition-all"
            >
              Open Orin
            </button>
          ) : (
            <>
              <button onClick={onLogin} className="px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest text-stone-500 hover:text-stone-800 dark:hover:text-white transition-colors">
                Sign in
              </button>
              <button
                onClick={() => onStartChat()}
                className="px-4 py-2 rounded-full bg-gradient-to-br from-cyan-500 to-sky-600 text-white text-[10px] font-black uppercase tracking-widest shadow-md shadow-cyan-500/20 hover:brightness-105 transition-all"
              >
                Try free
              </button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-3xl mx-auto w-full px-5 pt-16 pb-12 text-center">
          <div className="relative inline-block mb-7">
            <div className="absolute inset-0 bg-cyan-500/30 blur-[60px] rounded-full scale-150" aria-hidden />
            <img src="/favicon.svg" alt="" className="relative w-20 h-20 drop-shadow-xl" />
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-stone-900 dark:text-white">
            {t.slogan || 'Your AI, in your language.'}
          </h1>
          <p className="mt-4 text-sm md:text-base text-stone-500 dark:text-stone-400 max-w-xl mx-auto leading-relaxed">
            Chat, create images, speak and translate in English, Sinhala and Tamil.
            Free models are available while supported, with fair-use limits.
          </p>

          {/* Prompt box */}
          <div className="mt-9 max-w-xl mx-auto rounded-[26px] bg-white dark:bg-stone-900 border border-black/[0.07] dark:border-white/[0.08] shadow-xl shadow-black/[0.04] p-2 flex items-end gap-1.5">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onStartChat(prompt.trim() || undefined); } }}
              rows={1}
              placeholder="Ask anything — e.g. explain photosynthesis simply…"
              className="flex-1 resize-none max-h-32 bg-transparent outline-none px-3 pt-2 pb-1 text-[15px] font-medium text-stone-900 dark:text-white placeholder:text-stone-400 custom-scrollbar"
            />
            <button
              onClick={() => onStartChat(prompt.trim() || undefined)}
              className="w-9 h-9 shrink-0 m-0.5 rounded-full flex items-center justify-center bg-gradient-to-br from-cyan-500 to-sky-600 text-white shadow-md shadow-cyan-500/25 hover:brightness-105 active:scale-95 transition-all"
              aria-label="Send"
            >
              <i className="fa-solid fa-arrow-up text-sm" />
            </button>
          </div>
          <p className="mt-3 text-[11px] text-stone-400 dark:text-stone-500 font-semibold select-none">
            One Orin account · Free models while supported · Runs on Orin Cloud
          </p>
        </section>

        {/* Cards */}
        <section className="max-w-4xl mx-auto w-full px-5 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cards.map((c, i) => (
              <a
                key={c.hash}
                href={c.hash}
                className="group p-5 rounded-2xl bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] shadow-sm hover:shadow-lg hover:border-cyan-500/40 hover:-translate-y-0.5 transition-all no-underline"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <i className={`fa-solid ${c.icon} text-sm`} aria-hidden />
                </span>
                <span className="block text-sm font-bold text-stone-900 dark:text-white">{c.title}</span>
                <span className="block mt-1 text-xs text-stone-500 dark:text-stone-400 leading-relaxed">{c.desc}</span>
              </a>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-black/[0.05] dark:border-white/[0.05] py-8 px-5">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] text-stone-400 dark:text-stone-500 text-center sm:text-left">
            {APP_CONFIG.branding}
          </p>
          <div className="flex items-center gap-2">
            {SOCIALS.map(s => (
              <a key={s.icon} href={s.href} target="_blank" rel="noopener noreferrer"
                className="w-8 h-8 rounded-full border border-stone-200 dark:border-white/10 flex items-center justify-center text-stone-400 hover:text-cyan-600 hover:border-cyan-500/40 transition-colors"
                aria-label={s.href}>
                <i className={`fa-brands ${s.icon} text-xs`} aria-hidden />
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
