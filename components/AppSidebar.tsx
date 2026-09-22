import React, { useMemo, useState } from 'react';
import { UserAccount, Conversation, Language } from '../types';

interface AppSidebarProps {
  conversations: Conversation[];
  activeConvId: string | null;
  user: UserAccount | null;
  lang: Language;
  /** Mobile drawer state; desktop shows the rail permanently. */
  open: boolean;
  onClose: () => void;
  onSwitchConv: (id: string) => void;
  onNewConv: () => void;
  onDeleteConv: (id: string) => void;
}

function conversationPreview(c: Conversation): string {
  const parts = [c.title || ''];
  for (const m of c.messages || []) {
    if (typeof m.content === 'string') parts.push(m.content);
    if (parts.join(' ').length > 600) break;
  }
  return parts.join(' ').toLowerCase();
}

const AppSidebar: React.FC<AppSidebarProps> = ({
  conversations, activeConvId, user, onSwitchConv, onNewConv, onDeleteConv, open, onClose,
}) => {
  const [query, setQuery] = useState('');

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [conversations]
  );
  const q = query.trim().toLowerCase();
  const visible = q ? sorted.filter(c => conversationPreview(c).includes(q)) : sorted;

  return (
    <>
      {/* Mobile scrim */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-[140] md:hidden animate-fade" onClick={onClose} aria-hidden />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-[150] w-[272px] flex flex-col bg-stone-100 dark:bg-[#121110] border-r border-black/[0.06] dark:border-white/[0.05] transition-transform duration-200 ease-out
          md:relative md:z-auto md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Conversations"
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <button onClick={() => { window.location.hash = 'landing'; onClose(); }} className="flex items-center gap-2.5 group" title="Home">
            <img src="/favicon.svg" alt="" className="w-8 h-8 drop-shadow-md transition-transform group-hover:scale-105" />
            <span className="text-sm font-black tracking-tight text-stone-900 dark:text-white">Orin Chat</span>
          </button>
          <button onClick={onClose} className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5" aria-label="Close menu">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* New chat */}
        <div className="px-3 pb-2">
          <button
            onClick={() => { onNewConv(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-br from-cyan-500 to-sky-500 text-stone-950 text-[11px] font-black uppercase tracking-widest shadow-md shadow-cyan-500/20 hover:brightness-105 active:scale-[0.98] transition-all"
          >
            <i className="fa-solid fa-plus text-[10px]" aria-hidden /> New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-stone-400 pointer-events-none" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] text-xs text-stone-800 dark:text-stone-200 placeholder:text-stone-400 outline-none focus:border-cyan-500/50 transition-colors"
              aria-label="Search conversations"
            />
          </div>
        </div>

        {/* History */}
        <nav className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 min-h-0">
          {visible.length === 0 && (
            <p className="px-3 py-6 text-center text-[11px] text-stone-400 dark:text-stone-500">
              {q ? 'No chats match that search.' : 'Your conversations will appear here.'}
            </p>
          )}
          {visible.map(c => {
            const active = c.id === activeConvId;
            return (
              <div key={c.id} className={`group relative mb-0.5 rounded-xl transition-colors ${active ? 'bg-cyan-500/15 dark:bg-cyan-500/10' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'}`}>
                <button
                  onClick={() => { onSwitchConv(c.id); onClose(); }}
                  className={`w-full text-left pl-3 pr-9 py-2.5 rounded-xl text-xs font-semibold truncate block ${active ? 'text-stone-900 dark:text-white' : 'text-stone-500 dark:text-stone-400'}`}
                >
                  {active && <span className="inline-block w-1 h-1 mr-2 rounded-full bg-cyan-500 align-middle" aria-hidden />}
                  {c.title || 'New Chat'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Delete this conversation?')) onDeleteConv(c.id);
                  }}
                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg items-center justify-center text-stone-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 transition-all ${active ? 'flex' : 'hidden group-hover:flex'}`}
                  title="Delete"
                  aria-label="Delete conversation"
                >
                  <i className="fa-solid fa-trash text-[11px]" />
                </button>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-black/[0.05] dark:border-white/[0.05] p-3 space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { hash: 'voice', icon: 'fa-microphone', label: 'Voice' },
              { hash: 'translate', icon: 'fa-language', label: 'Translate' },
            ] as const).map(item => (
              <button
                key={item.hash}
                onClick={() => { window.location.hash = item.hash; onClose(); }}
                title={item.label}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-stone-800 dark:hover:text-white transition-colors"
              >
                <i className={`fa-solid ${item.icon} text-sm`} aria-hidden />
                <span className="text-[8px] font-black uppercase tracking-widest">{item.label}</span>
              </button>
            ))}
          </div>
          {user ? (
            <button onClick={() => { window.location.hash = 'account'; onClose(); }}
              className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors text-left">
              <span className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-cyan-500 to-sky-500 flex items-center justify-center shrink-0 shadow-sm">
                {user.avatar
                  ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                  : <span className="text-xs font-black text-stone-950">{(user.name?.[0] || 'U').toUpperCase()}</span>}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-stone-800 dark:text-stone-100 truncate">{user.name}</span>
                <span className="block text-[10px] text-stone-400 dark:text-stone-500 truncate">{user.email}</span>
              </span>
            </button>
          ) : (
            <button onClick={() => { window.location.hash = 'account'; onClose(); }}
              className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors text-left">
              <span className="w-8 h-8 rounded-full bg-stone-300 dark:bg-stone-700 flex items-center justify-center shrink-0">
                <i className="fa-solid fa-user text-[11px] text-stone-500" aria-hidden />
              </span>
              <span className="text-xs font-bold text-stone-500 dark:text-stone-400">Sign in to sync</span>
            </button>
          )}
          <p className="px-2 pt-1 text-[9px] font-bold uppercase tracking-widest text-stone-400/70 dark:text-stone-600 select-none">
            Free · Unlimited · orinai.org
          </p>
        </div>
      </aside>
    </>
  );
};

export default AppSidebar;
