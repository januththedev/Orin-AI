import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, lazy, Suspense } from 'react';
import AppSidebar from './components/AppSidebar';
const LandingPage = lazy(() => import('./components/LandingPage'));
const DownloadsPage = lazy(() => import('./components/DownloadsPage'));
import { ChatMessage, Language, AppView, WorkspaceMode, Conversation, UserAccount, conversationHasUserMessage, UserThemeId } from './types';
import { geminiService } from './services/geminiService';
import { sessionService } from './services/sessionService';
import { notificationService } from './services/notificationService';
import { cacheService, CacheKey } from './services/cacheService';
import { translations } from './translations';

// Lazy-load heavy views so initial bundle is smaller (BFF-style: less JS on first paint).
const ChatWorkspace = lazy(() => import('./components/ChatWorkspace'));
const AccountSettings = lazy(() => import('./components/AccountSettings').then(m => ({ default: m.default })));
const PrivacyPage = lazy(() => import('./components/PrivacyPage').then(m => ({ default: m.default })));
const TermsPage = lazy(() => import('./components/TermsPage').then(m => ({ default: m.default })));
const AdminPortal = lazy(() => import('./components/AdminPortal').then(m => ({ default: m.default })));
const DeviceAuthPage = lazy(() => import('./components/DeviceAuthPage').then(m => ({ default: m.default })));
const VoiceAssistant = lazy(() => import('./components/VoiceAssistant'));
const LiveTranslate = lazy(() => import('./components/VoiceAssistant'));
const PageFallback = () => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-slate-50 dark:bg-slate-950">
    <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Loading…</span>
  </div>
);

/** Build searchable text for a conversation (title + user messages) for embedding. Max ~4k chars for context. */
function conversationToSearchText(c: Conversation): string {
  const parts = [c.title ?? 'Chat'];
  for (const m of (c.messages ?? [])) {
    if (m.role === 'user' && typeof m.content === 'string') parts.push(m.content);
  }
  const text = parts.join('\n');
  return text.length > 4000 ? text.slice(0, 4000) : text;
}

const FULL_PAGE_VIEWS: AppView[] = ['landing', 'account', 'privacy', 'terms', 'device-auth', 'admin-portal', 'voice', 'translate', 'downloads'];
const VALID_VIEWS: AppView[] = ['landing', 'chat', 'account', 'privacy', 'terms', 'device-auth', 'admin-portal', 'voice', 'translate', 'downloads'];
const AUTH_TIMEOUT_MS = 25000; // iOS redirect needs up to 15s

type AuthUserLike = { uid: string; email: string | null; displayName: string | null; photoURL: string | null };

/** Local-only user used when session sync fails — keeps the UI working offline. */
function makeFallbackUser(authUser: AuthUserLike): UserAccount {
  return {
    id: authUser.uid,
    name: authUser.displayName || authUser.email?.split('@')[0] || 'User',
    email: authUser.email || 'user@orin.ai',
    avatar: authUser.photoURL || undefined,
    tier: 'Free',
    plan: 'free',
    role: 'visitor',
    approved: false,
    dailyUsage: { text: 0, images: 0, videos: 0 },
  };
}

/** Clear localStorage keys + SW caches that are irrelevant to signed-out guests.
 *  Prevents iOS Safari from serving stale auth state from a cached page load. */
async function clearGuestCaches() {
  // Remove user-specific localStorage keys (keep lang/theme prefs)
  const keepKeys = new Set([CacheKey.LANG, CacheKey.THEME, CacheKey.USER_THEME]);
  Object.keys(localStorage)
    .filter(k => k.startsWith('orin_') && !keepKeys.has(k as CacheKey))
    .forEach(k => localStorage.removeItem(k));
  // Nuke SW caches so iOS doesn't serve a stale index.html with embedded auth state
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  } catch {}
}
const SAVE_DEBOUNCE_MS = 3000;
// Treat local conversations from the last 7 days as eligible to merge into cloud
const RECENT_LOCAL_MS = 7 * 24 * 60 * 60 * 1000;

type ThemeMode = 'light' | 'dark' | 'auto';

const getIsNightByLocalTime = (): boolean => {
  const hour = new Date().getHours();
  return hour < 6 || hour >= 18; // 6am–6pm = day (light), else night (dark)
};

const VALID_USER_THEMES: UserThemeId[] = ['classic', 'midnight', 'aurora', 'terminal', 'paper', 'ocean', 'sunset', 'neon'];
const normalizeUserTheme = (value: unknown): UserThemeId => {
  if (value && typeof value === 'string' && VALID_USER_THEMES.includes(value as UserThemeId)) return value as UserThemeId;
  return 'classic'; // new users or invalid → classic so animations and theme always work
};

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => cacheService.get<Language>(CacheKey.LANG, 'en'));
  const [theme, setTheme] = useState<ThemeMode>(() => (cacheService.get<string | null>(CacheKey.THEME, null) as ThemeMode | null) || 'light');
  const [autoDark, setAutoDark] = useState(() => getIsNightByLocalTime()); // when theme === 'auto', true = dark
  const [userTheme, setUserTheme] = useState<UserThemeId>(() => normalizeUserTheme(cacheService.get(CacheKey.USER_THEME, 'classic')));
  const t = translations[lang];

  const effectiveDark = theme === 'auto' ? autoDark : theme === 'dark';

  // Global Auth State
  const [user, setUser] = useState<UserAccount | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  // App State
  const [view, setView] = useState<AppView>('landing');
  const [globalPrompt, setGlobalPrompt] = useState('');
  const [shouldAutoSubmit, setShouldAutoSubmit] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [authError, setAuthError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global reasoning style for chat workspace
  const [thinkingMode, setThinkingMode] = useState(false);
  const [descriptiveMode, setDescriptiveMode] = useState(false);

  // Viewport Scaling & Height Fix for Small Devices
  useLayoutEffect(() => {
    const handleResize = () => {
      const root = document.getElementById('root');
      if (!root) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      document.documentElement.style.setProperty('--vh', `${height * 0.01}px`);
      const MIN_WIDTH = 375;
      if (width < MIN_WIDTH) {
         const scale = width / MIN_WIDTH;
         root.style.transform = `scale(${scale})`;
         root.style.transformOrigin = 'top left';
         root.style.width = `${MIN_WIDTH}px`;
         root.style.height = `${height / scale}px`;
         root.style.position = 'absolute'; 
         root.style.overflow = 'hidden';
      } else {
         root.style.transform = '';
         root.style.transformOrigin = '';
         root.style.width = '';
         root.style.height = '';
         root.style.position = '';
         root.style.overflow = '';
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'si' ? 'si' : lang === 'ta' ? 'ta' : 'en';
  }, [lang]);

  // OAuth callback — route code to the correct backend handler
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    // Google OAuth callback (path-based)
    if (window.location.pathname.includes('/auth/google/callback')) {
      import('./services/googleIntegrationService').then(({ handleOAuthCallback }) => {
        handleOAuthCallback().then(result => {
          if (result) window.location.hash = 'account';
        });
      });
      return;
    }

    // Spotify callback — store code for AIProviderSettings to exchange via /api/auth/spotify
    sessionStorage.setItem('oauth_callback_code', code);
    window.history.replaceState({}, '', '/');
    if (!window.location.hash.includes('account')) window.location.hash = 'account';
  }, []);

  // When theme is 'auto', update autoDark from local time every minute
  useEffect(() => {
    if (theme !== 'auto') return;
    const update = () => setAutoDark(getIsNightByLocalTime());
    update();
    const id = setInterval(update, 60 * 1000);
    return () => clearInterval(id);
  }, [theme]);

  // Keep HTML dark class in sync with effective mode (light/dark/auto by time)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', effectiveDark);
  }, [effectiveDark]);

  // --- 1. AUTH INITIALIZATION & SYNC ---
  // applyUser lives further down (needs mergeHistory); effects run after render,
  // so we reach it through a ref to keep this subscription early.
  const applyUserRef = useRef<(authUser: AuthUserLike) => Promise<void>>(async () => {});

  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      if (!authInitialized) {
        // Allow the app to render as guest and surface a clear message instead of
        // leaving the user on an endless spinner with no explanation.
        setAuthError('Taking longer than usual to connect. Showing guest view while we finish signing you in.');
        setAuthInitialized(true);
      }
    }, AUTH_TIMEOUT_MS);

    // Subscribe IMMEDIATELY on mount — the stored session resolves locally,
    // so the user-restored event is never missed (no more infinite loading).
    let unsubscribe: (() => void) | undefined;
    let authHandled = false;
    unsubscribe = sessionService.onAuthStateChanged(async (authUser) => {
      clearTimeout(safetyTimeout);
      setAuthError(null);
      if (authUser) {
        authHandled = true;
        await applyUserRef.current(authUser);
        // Resume an interrupted desktop-device approval after the sign-in detour.
        const deviceReturn = sessionStorage.getItem('device-auth-return');
        if (deviceReturn) {
          sessionStorage.removeItem('device-auth-return');
          window.location.hash = deviceReturn;
        }
      } else {
        // Signed out (or session expired) — the null event declares it
        // directly; no redirect dance to wait for anymore.
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && !authHandled) {
          await new Promise(r => setTimeout(r, 3000));
          const retryUser = sessionService.currentUser();
          if (retryUser) { await applyUserRef.current(retryUser); return; }
        }
        setUser(null);
        geminiService.logout();
        // Clear stale guest caches so iOS doesn't serve old auth state from SW cache
        clearGuestCaches();
        setAuthInitialized(true);
      }
    });

    // No redirect flow anymore (GIS signs in in place) — kept as a harmless
    // no-op so a cached older bundle can't crash on this call.
    sessionService.getRedirectResult().then(({ error }) => {
      if (error) setAuthError(error);
    }).catch(() => {});

    return () => {
      unsubscribe?.();
      clearTimeout(safetyTimeout);
    };
  }, []);

  // --- 2. ROUTING LOGIC ---
  useEffect(() => {
    const handleHash = () => {
      const hashPart = window.location.hash.replace(/^#+/, '');
      const [path, qs] = hashPart.includes('?') ? hashPart.split('?', 2) : [hashPart, ''];
      const hash = path;
      const params = new URLSearchParams(qs);

      // ADMIN PORTAL DETECTION
      if (hash === 'admin-portal') {
          setView('admin-portal');
          return;
      }

      if (hash === '' || hash === '/' || hash === 'home') {
         setView('landing');
         return;
      }
      if (VALID_VIEWS.includes(hash as AppView)) {
          setView(hash as AppView);
          if (hash === 'chat') {
            const promptFromUrl = params.get('prompt');
            if (promptFromUrl !== null) {
              try { setGlobalPrompt(decodeURIComponent(promptFromUrl)); } catch { /* ignore malformed */ }
            }
          }
      } else {
          setView('landing');
      }
    };
    if (authInitialized) handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [user, authInitialized]);

  // --- 3. CONVERSATION STATE (only load conversations that have at least one message) ---
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = cacheService.get<any[]>(CacheKey.HISTORY, []);
      if (!Array.isArray(saved)) return [];
      return saved
        .map((c: any) => ({
          ...c,
          timestamp: new Date(c.timestamp),
          messages: (c.messages || []).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
        }))
        .filter((c: any) => (c.messages || []).some((m: { role: string }) => m.role === 'user'));
    } catch { return []; }
  });
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null); // always fresh on load

  const saveTimeoutRef = useRef<number | null>(null);
  const bootstrappedConvRef = useRef(false);

  // Drop conversations with no user messages when switching away
  useEffect(() => {
    setConversations(prev => {
      const keep = prev.filter(c => c.id === activeConversationId || conversationHasUserMessage(c));
      return keep.length === prev.length ? prev : keep;
    });
  }, [activeConversationId]);

  // Also sweep empties 500ms after any conversation count change (catches abandoned chats)
  useEffect(() => {
    const t = setTimeout(() => {
      setConversations(prev => {
        const keep = prev.filter(c => c.id === activeConversationId || conversationHasUserMessage(c));
        return keep.length === prev.length ? prev : keep;
      });
    }, 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  useEffect(() => {
    const meaningfulConversations = conversations.filter(conversationHasUserMessage);
    cacheService.set(CacheKey.HISTORY, meaningfulConversations);
    if (activeConversationId) cacheService.set(CacheKey.ACTIVE_CONV, activeConversationId);
    if (user?.id) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = window.setTimeout(async () => {
        try {
          // Compute embeddings first when due (2–4s) so the sync spinner is only shown for the actual write.
          let embeddingsByConvId: Record<string, number[]> | undefined;
          const EMBEDDING_MIN_INTERVAL_MS = 2 * 60 * 1000;
          if (meaningfulConversations.length > 0 && Date.now() - lastEmbeddingAtRef.current >= EMBEDDING_MIN_INTERVAL_MS) {
            lastEmbeddingAtRef.current = Date.now();
            try {
              const texts = meaningfulConversations.map(conversationToSearchText);
              const vectors = await geminiService.embedText(texts).catch(() => []);
              if (vectors.length === meaningfulConversations.length) {
                embeddingsByConvId = {};
                meaningfulConversations.forEach((c, i) => {
                  if (vectors[i]?.length) embeddingsByConvId![c.id] = vectors[i];
                });
                if (Object.keys(embeddingsByConvId).length === 0) embeddingsByConvId = undefined;
              }
            } catch {
              // Ignore; search will fall back to recency.
            }
          }
          setSyncStatus('syncing');
          await sessionService.saveHistory(user.id, meaningfulConversations, []);
          setSyncStatus('success');
          setTimeout(() => setSyncStatus('idle'), 2000);
        } catch {
          setSyncStatus('error');
        }
      }, SAVE_DEBOUNCE_MS);
    }
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [conversations, activeConversationId, user?.id]);

  useEffect(() => {
    if (!activeConversationId) return;
    const exists = conversations.some(c => c.id === activeConversationId);
    if (!exists) setActiveConversationId(conversations[0]?.id ?? null);
  }, [conversations, activeConversationId]);

  // Sync global reasoning toggles from the active conversation so switching convs restores that conv's modes.
  useEffect(() => {
    if (!activeConversationId) return;
    const active = conversations.find(c => c.id === activeConversationId);
    setThinkingMode(active?.thinkingMode ?? false);
    setDescriptiveMode(active?.descriptiveMode ?? false);
  }, [activeConversationId, conversations]);

  // When on chat with no active conversation, create one so the first message isn't dropped.
  useEffect(() => {
    if (view !== 'chat') return;
    if (activeConversationId != null || bootstrappedConvRef.current) return;
    const newId = Date.now().toString();
    setConversations(prev => [{ id: newId, title: 'New Chat', messages: [], timestamp: new Date(), mode: 'chat', modesUsed: ['chat'], thinkingMode, descriptiveMode }, ...prev]);
    setActiveConversationId(newId);
    bootstrappedConvRef.current = true;
  }, [view, activeConversationId, thinkingMode, descriptiveMode]);

  const mergeHistory = useCallback((cloudHistory: Conversation[]) => {
    const withUserMessages = (cloudHistory || []).filter(c => conversationHasUserMessage(c));
    const cloudIds = new Set(withUserMessages.map(c => c.id));
    setConversations(prev => {
      const prevMeaningful = prev.filter(conversationHasUserMessage);
      const combined = new Map<string, Conversation>();
      for (const c of withUserMessages) combined.set(c.id, c);
      for (const c of prevMeaningful) {
        const inCloud = cloudIds.has(c.id);
        const time = new Date(c.timestamp).getTime();
        const recent = Date.now() - time < RECENT_LOCAL_MS;
        if (inCloud) {
          const cloud = combined.get(c.id)!;
          const cloudMsg = (cloud.messages || []).length;
          const localMsg = c.messages.length;
          const cloudTime = new Date(cloud.timestamp).getTime();
          const localTime = time;
          if (localMsg > cloudMsg || (localMsg === cloudMsg && localTime > cloudTime)) combined.set(c.id, c);
        } else if (recent) {
          combined.set(c.id, c);
        }
      }
      return [...combined.values()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    });
  }, []);

  const SYNC_PULL_INTERVAL_MS = 5 * 60 * 1000; // 5 min to avoid burning DB reads
  const MIN_PULL_GAP_MS = 2 * 60 * 1000; // don't pull on every tab focus; at least 2 min since last pull
  const lastPullTimeRef = useRef<number>(0);
  const lastCloudRef = useRef<Conversation[] | null>(null);
  // Throttle expensive embedding calls so we don't re-embed all conversations on every keystroke.
  const lastEmbeddingAtRef = useRef<number>(0);
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    const pull = async () => {
      const now = Date.now();
      // Skip background pulls when the tab isn't visible to reduce server reads.
      if (document.visibilityState !== 'visible') return;
      if (now - lastPullTimeRef.current < MIN_PULL_GAP_MS) return;
      lastPullTimeRef.current = now;
      try {
        const cloud = await sessionService.getHistory(uid);
        if (cloud?.length !== undefined) {
          lastCloudRef.current = cloud;
          mergeHistory(cloud);
        }
      } catch {
        // ignore; will retry on next focus or interval
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') pull();
    };
    document.addEventListener('visibilitychange', onVisibility);
    pull(); // initial pull (only if tab is visible)
    const intervalId = window.setInterval(pull, SYNC_PULL_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(intervalId);
    };
  }, [user?.id, mergeHistory]);

  /** Single sign-in/restore path — used by onAuthStateChanged AND explicit sign-in callbacks. */
  const applyUser = useCallback(async (authUser: AuthUserLike) => {
    const fallbackUser = makeFallbackUser(authUser);
    try {
      const syncedUser = await sessionService.syncUserSession(authUser.uid, authUser.email || 'user@orin.ai', authUser.photoURL);
      geminiService.setSessionUser(syncedUser);
      setUser(syncedUser);
      if (syncedUser.theme) {
        setUserTheme(normalizeUserTheme(syncedUser.theme));
        cacheService.set(CacheKey.USER_THEME, syncedUser.theme);
      }
      setSyncStatus('syncing');
      const cloudHistory = await sessionService.getHistory(authUser.uid);
      if (cloudHistory) {
        lastCloudRef.current = cloudHistory;
        mergeHistory(cloudHistory);
      }
      setSyncStatus('success');
      notificationService.setupForUser().catch(() => {});
    } catch {
      // Sync unavailable: degrade gracefully to a local-only user but keep
      // Gemini in guest mode so usage limits stay honest.
      setUser(fallbackUser);
      setSyncStatus('error');
    }
    setAuthInitialized(true);
    setAuthError(null);
  }, [mergeHistory]);

  useEffect(() => { applyUserRef.current = applyUser; }, [applyUser]);

  // SW-triggered plan recheck (catches missed upgrade notifications).
  // Registered ONCE per page load — previously every sign-in stacked another listener.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = async (e: MessageEvent) => {
      if (e.data?.type !== 'RECHECK_PLAN') return;
      const authUser = sessionService.currentUser();
      if (!authUser) return;
      try {
        const refreshed = await sessionService.syncUserSession(authUser.uid, authUser.email || '', authUser.photoURL);
        setUser(refreshed);
        geminiService.setSessionUser(refreshed);
      } catch { /* non-blocking */ }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, []);

  const handleStartWorkspace = (prompt: string = '', _mode: WorkspaceMode = 'chat', autoSubmit: boolean = false) => {
    setGlobalPrompt(prompt);
    setShouldAutoSubmit(autoSubmit);
    const activeConv = conversations.find(c => c.id === activeConversationId);
    const canReuseActive = activeConv && !conversationHasUserMessage(activeConv);
    if (!canReuseActive) {
       const newId = Date.now().toString();
       setConversations(prev => [{ id: newId, title: "New Chat", messages: [], timestamp: new Date(), mode: 'chat', modesUsed: ['chat'] }, ...prev]);
       setActiveConversationId(newId);
    }
    window.location.hash = 'chat';
  };

  const handleDeleteConversation = async (id: string) => {
    const prevConversations = conversations;
    const prevActiveId = activeConversationId;
    const next = conversations.filter(c => c.id !== id);
    setConversations(next);
    if (activeConversationId === id) setActiveConversationId(next[0]?.id || null);
    const meaningful = next.filter(conversationHasUserMessage);
    if (user?.id) {
      try {
        setSyncStatus('syncing');
        await sessionService.saveHistory(user.id, meaningful, [id]);
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 2000);
      } catch {
        alert('Failed to delete conversation. Your history was not updated in the cloud.');
        setSyncStatus('error');
        // revert UI so next sync does not resurrect the conversation unexpectedly
        setConversations(prevConversations);
        setActiveConversationId(prevActiveId);
      }
    }
  };

  const handleClearHistory = async () => {
    if (window.confirm("Are you sure you want to delete all chat history?")) {
       setConversations([]);
       setActiveConversationId(null);
       cacheService.remove(CacheKey.HISTORY);
       cacheService.remove(CacheKey.ACTIVE_CONV);
       if (user?.id) await sessionService.saveHistory(user.id, [], []);
       window.location.hash = 'chat';
    }
  };

  const updateReasoningModes = (opts: { thinking?: boolean; descriptive?: boolean }) => {
    const nextThinking = opts.thinking ?? thinkingMode;
    const nextDescriptive = opts.descriptive ?? descriptiveMode;
    setThinkingMode(nextThinking);
    setDescriptiveMode(nextDescriptive);
    if (activeConversationId) {
      setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, thinkingMode: nextThinking, descriptiveMode: nextDescriptive } : c));
    }
  };

  const handleThemeChange = async (nextTheme: UserThemeId) => {
    // Themes now have light + dark variants; no need to force mode.
    setUserTheme(nextTheme);
    cacheService.set(CacheKey.USER_THEME, nextTheme);
    if (user?.id) {
      // theme saved locally only — no separate Firestore field needed
    }
  };

  const renderContent = () => {
    if (!authInitialized) return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6">
         <div className="relative">
            <div className="w-16 h-16 rounded-full border-2 border-cyan-500/20 border-t-cyan-500 animate-spin"></div>
            <img src="/favicon.svg" alt="" className="absolute inset-0 m-auto w-7 h-7" />
         </div>
         <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest animate-pulse">Warming up…</p>
      </div>
    );

    switch (view) {
      case 'admin-portal':
        return <AdminPortal user={user} onClose={() => window.location.hash = 'chat'} />;
      case 'device-auth':
        return <DeviceAuthPage user={user} onClose={() => window.location.hash = 'chat'} />;
      case 'account':
        return <AccountSettings onClose={() => window.location.hash = 'chat'} lang={lang} user={user} onClearHistory={handleClearHistory} conversationsCount={conversations.filter(conversationHasUserMessage).length} authError={authError} onDismissAuthError={() => setAuthError(null)} />;
      case 'privacy':
        return <PrivacyPage onClose={() => window.location.hash = 'chat'} lang={lang} />;
      case 'terms':
        return <TermsPage onClose={() => window.location.hash = 'chat'} lang={lang} />;
      case 'landing':
        return <LandingPage lang={lang} user={user} onStartChat={(prompt) => handleStartWorkspace(prompt || '')} onLogin={() => window.location.hash = 'account'} />;
      case 'downloads':
        return <DownloadsPage onClose={() => window.location.hash = 'landing'} lang={lang} />;
      case 'voice':
        return <VoiceAssistant onClose={() => window.location.hash = 'chat'} lang={lang} />;
      case 'translate':
        return <LiveTranslate onClose={() => window.location.hash = 'chat'} lang={lang} initialMode="translator" />;
      default:
        return null;
    }
  };

  const activeConv = conversations.find(c => c.id === activeConversationId);
  const isFullPage = FULL_PAGE_VIEWS.includes(view);

  const renderChat = () => (
    <div className="flex h-full min-h-0 w-full">
      <AppSidebar
        conversations={conversations}
        activeConvId={activeConversationId}
        user={user}
        lang={lang}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSwitchConv={setActiveConversationId}
        onNewConv={() => handleStartWorkspace('')}
        onDeleteConv={handleDeleteConversation}
      />
      <main className="flex-1 flex flex-col min-w-0 h-full bg-white dark:bg-[#0d0b09] view-enter">
        <Suspense fallback={<PageFallback />}>
          <ChatWorkspace
            onOpenSidebar={() => setSidebarOpen(true)}
            messages={activeConv?.messages || []}
            setMessages={(updater) => {
              if (!activeConversationId) return;
              setConversations(prev => prev.map(c => c.id === activeConversationId
                ? { ...c, messages: typeof updater === 'function' ? updater(c.messages) : updater, timestamp: new Date() }
                : c));
            }}
            lang={lang}
            activeConvId={activeConversationId || ''}
            seedPrompt={globalPrompt}
            onSeedConsumed={() => setGlobalPrompt('')}
            onUpdateTitle={(title) => setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, title } : c))}
            isSyncing={syncStatus === 'syncing'}
            thinkingMode={thinkingMode}
            descriptiveMode={descriptiveMode}
            onReasoningModeChange={updateReasoningModes}
          />
        </Suspense>
      </main>
    </div>
  );

  return (
    <div
      className={`flex flex-col relative ${lang === 'si' ? 'sinhala-text' : lang === 'ta' ? 'tamil-text' : 'font-sans'} bg-stone-50 dark:bg-[#0d0b09] text-stone-900 dark:text-stone-100 overflow-hidden`}
      style={{ minWidth: '100vw', width: '100%', height: 'calc(var(--vh, 1vh) * 100)' }}
    >
      {isFullPage ? (
        <main className="flex-1 overflow-y-auto custom-scrollbar relative">
          <div key={view} className="min-h-full view-enter">
            <Suspense fallback={<PageFallback />}>
              {renderContent()}
            </Suspense>
          </div>
        </main>
      ) : (
        renderChat()
      )}
    </div>
  );
};

export default App;
