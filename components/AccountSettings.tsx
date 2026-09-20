
import React, { useState, useEffect } from 'react';
import { firebaseService } from '../services/firebaseService';
import { UserAccount, Language } from '../types';
import { translations } from '../translations';

export type ThemeMode = 'light' | 'dark' | 'auto';

interface AccountSettingsProps {
  onClose: () => void;
  lang: Language;
  user: UserAccount | null;
  onClearHistory: () => void;
  conversationsCount?: number;
  authError?: string | null;
  onDismissAuthError?: () => void;
  onSignInWithUser?: (authUser: { uid: string; email: string | null; displayName: string | null; photoURL: string | null }) => Promise<void>;
}

const MEMORY_MAX_LENGTH = 2000;

type AuthTab = 'login' | 'register' | 'reset';

const inputCls = "w-full px-4 py-3 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-white/10 text-sm text-stone-900 dark:text-white placeholder-stone-400 focus:outline-none focus:border-cyan-500/60 transition-colors";
const labelCls = "text-[10px] font-black text-stone-400 uppercase tracking-widest flex items-center gap-2 px-1";

const AccountSettings: React.FC<AccountSettingsProps> = ({ onClose, lang, user, onClearHistory, conversationsCount = 0, authError, onDismissAuthError }) => {
  const t = translations[lang];
  const [memory, setMemory] = useState("");
  const [loading, setLoading] = useState(false);
  const [usage, setUsage] = useState<{ text: number; images: number } | null>(null);
  // Auth form
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [authMsg, setAuthMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Profile editing
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Password management
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
     if (user) {
        firebaseService.getUserMemory(user.id).then(m => setMemory(m.slice(0, MEMORY_MAX_LENGTH)));
        firebaseService.getUsage(user.id).then(setUsage).catch(() => {});
        setEditName(user.name || '');
        setEditPhone(user.phone || '');
     } else {
        setEditName(''); setEditPhone('');
     }
     setProfileMsg(null); setPwMsg(null); setAuthMsg(null);
  }, [user]);

  const finalizeSignIn = async () => {
    const fbUser = firebaseService.currentUser();
    if (fbUser) {
      // Let the app's auth listener take over; call applyUser directly when provided.
      window.location.hash = 'chat';
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setAuthMsg(null);
    try {
      if (authTab === 'login') {
        await firebaseService.loginWithPassword(identifier.trim(), password);
        await finalizeSignIn();
      } else if (authTab === 'register') {
        await firebaseService.registerWithPassword(name.trim(), identifier.trim(), phone.replace(/[\s()\-.]/g, ''), password);
        await finalizeSignIn();
      } else if (!resetToken) {
        const token = await firebaseService.requestPasswordReset(name.trim(), identifier.trim(), phone.replace(/[\s()\-.]/g, ''));
        setResetToken(token);
        setAuthMsg({ kind: 'ok', text: 'Verified. Now choose a new password.' });
      } else {
        await firebaseService.confirmPasswordReset(resetToken, password);
        setResetToken(null);
        setAuthTab('login');
        setAuthMsg({ kind: 'ok', text: 'Password updated. Sign in with your new password.' });
      }
    } catch (err: any) {
      setAuthMsg({ kind: 'err', text: err?.message || 'Something went wrong. Try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    if (editName.trim().length < 2) { setProfileMsg({ kind: 'err', text: 'Name must be at least 2 characters.' }); return; }
    const phoneDigits = editPhone.replace(/[\s()\-.]/g, '');
    if (phoneDigits && !/^\+?\d{9,15}$/.test(phoneDigits)) {
      setProfileMsg({ kind: 'err', text: 'Enter a valid phone number (e.g. 0771234567 or +94771234567).' });
      return;
    }
    setLoading(true);
    try {
      await firebaseService.updateUserProfile(user.id, { name: editName.trim(), ...(phoneDigits ? { phone: phoneDigits.startsWith('0') ? '+94' + phoneDigits.slice(1) : phoneDigits } : {}) });
      setProfileMsg({ kind: 'ok', text: 'Profile saved.' });
    } catch {
      setProfileMsg({ kind: 'err', text: 'Could not save your profile. Check your connection and retry.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async () => {
    setPwMsg(null);
    if (newPw.length < 8 || !/[a-zA-Z]/.test(newPw) || !/\d/.test(newPw)) {
      setPwMsg({ kind: 'err', text: 'Password needs at least 8 characters with letters and numbers.' });
      return;
    }
    if (newPw !== confirmPw) { setPwMsg({ kind: 'err', text: 'Passwords do not match.' }); return; }
    setLoading(true);
    try {
      await firebaseService.setPassword(newPw);
      setNewPw(''); setConfirmPw('');
      setPwMsg({ kind: 'ok', text: 'Password saved. You can now sign in with your email/phone + password.' });
    } catch (err: any) {
      setPwMsg({ kind: 'err', text: err?.message || 'Could not set password.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMemory = async () => {
     if (user) {
        setLoading(true);
        const toSave = memory.slice(0, MEMORY_MAX_LENGTH);
        await firebaseService.updateUserMemory(user.id, toSave);
        if (memory.length > MEMORY_MAX_LENGTH) setMemory(toSave);
        setLoading(false);
     }
  };

  // Desktop shell (Electron wrapper) hands off through the system browser.
  const canBrowserLogin = typeof window !== 'undefined' && typeof (window as any).orinDesktop?.browserLogin === 'function';
  const [browserLoginBusy, setBrowserLoginBusy] = useState(false);
  const handleBrowserLogin = async () => {
    setLoading(true); setBrowserLoginBusy(true); setAuthMsg(null);
    try {
      const r = await (window as any).orinDesktop.browserLogin();
      if (!r?.ok) throw new Error(r?.error || 'Browser sign-in failed.');
      await firebaseService.signInWithCustom(r.customToken);
      window.location.hash = 'chat';
    } catch (err: any) {
      setAuthMsg({ kind: 'err', text: err?.message || 'Browser sign-in failed.' });
    } finally {
      setLoading(false); setBrowserLoginBusy(false);
    }
  };

  const [googleBusy, setGoogleBusy] = useState(false);
  const handleGoogle = async () => {
    setLoading(true); setGoogleBusy(true); setAuthMsg(null);
    try {
      await firebaseService.loginWithGoogle();
      // Popup path resolves signed-in; redirect path returns null and the
      // app's auth listener completes sign-in after the round trip.
      await finalizeSignIn();
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // User dismissed — not an error worth showing.
      } else if (code === 'auth/unauthorized-domain') {
        setAuthMsg({ kind: 'err', text: 'This domain is not authorized for sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.' });
      } else if (code === 'auth/operation-not-allowed') {
        setAuthMsg({ kind: 'err', text: 'Google sign-in is switched off. Enable the Google provider in Firebase Console → Authentication → Sign-in method.' });
      } else if (code === 'auth/account-exists-with-different-credential') {
        setAuthMsg({ kind: 'err', text: 'This email already has an account — sign in with your password instead.' });
      } else {
        setAuthMsg({ kind: 'err', text: err?.message || 'Google sign-in failed.' });
      }
    } finally {
      setLoading(false); setGoogleBusy(false);
    }
  };

  const handleLogout = async () => {
    await firebaseService.logout();
    window.location.hash = 'chat';
  };

  return (
    <div className="min-h-full flex flex-col animate-reveal">
      <header className="shrink-0 h-16 flex items-center justify-between px-5 md:px-8 border-b border-black/[0.05] dark:border-white/[0.05] bg-white/70 dark:bg-stone-900/60 backdrop-blur sticky top-0 z-40">
        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-stone-800 dark:text-white">{t.profile}</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center text-stone-400 hover:text-red-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors" aria-label="Back"><i className="fa-solid fa-xmark"></i></button>
      </header>

      <div className="flex-1 p-5 md:p-10">
        <div className="max-w-xl mx-auto flex flex-col items-center gap-8 pb-16">
          {authError && (
            <div className="w-full flex items-center justify-between gap-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 text-sm">
              <span className="flex-1">{authError}</span>
              {onDismissAuthError && <button type="button" onClick={onDismissAuthError} className="shrink-0 p-1 rounded-lg hover:bg-red-500/20" aria-label="Dismiss"><i className="fa-solid fa-xmark" /></button>}
            </div>
          )}
          {!user ? (
            <div className="w-full max-w-md flex flex-col items-center text-center space-y-6 pt-4">
              <div className="relative">
                <div className="absolute inset-0 bg-cyan-500 blur-[50px] opacity-25 rounded-full" aria-hidden />
                <div className="relative w-20 h-20 bg-white dark:bg-stone-900 rounded-[26px] flex items-center justify-center shadow-xl border border-black/[0.05] dark:border-white/10">
                  <img src="/favicon.svg" alt="" className="w-11 h-11" />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black tracking-tight text-stone-900 dark:text-white">Welcome to Orin</h3>
                <p className="text-sm text-stone-500 dark:text-stone-400 mt-2">One free account for chat history, memory and sync across web and desktop.</p>
              </div>

              {/* Tabs */}
              <div className="flex w-full p-1 rounded-2xl bg-stone-200/60 dark:bg-stone-900">
                {(['login', 'register', 'reset'] as const).map(id => (
                  <button key={id} type="button" onClick={() => { setAuthTab(id); setResetToken(null); setAuthMsg(null); }}
                    className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${authTab === id ? 'bg-white dark:bg-stone-800 text-cyan-600 dark:text-cyan-300 shadow-sm' : 'text-stone-400'}`}>
                    {id === 'login' ? 'Sign in' : id === 'register' ? 'Create' : 'Reset'}
                  </button>
                ))}
              </div>

              <form onSubmit={handleAuthSubmit} className="w-full space-y-3">
                {(authTab === 'register' || authTab === 'reset') && (
                  <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" aria-label="Full name" autoComplete="name" required />
                )}
                <input className={inputCls} value={identifier} onChange={e => setIdentifier(e.target.value)}
                  placeholder={authTab === 'register' ? 'Email address' : 'Email or phone'} aria-label="Email or phone"
                  autoComplete="username" required />
                {authTab === 'register' && (
                  <input className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (0771234567)" aria-label="Phone" autoComplete="tel" required />
                )}
                {(authTab === 'login' || authTab === 'register' || resetToken) && (
                  <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder={authTab === 'register' ? 'Password (8+ chars)' : resetToken ? 'New password' : 'Password'} aria-label="Password"
                    autoComplete={authTab === 'login' ? 'current-password' : 'new-password'} required />
                )}
                {authMsg && (
                  <p role="status" className={`text-xs font-bold px-1 ${authMsg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{authMsg.text}</p>
                )}
                <button type="submit" disabled={loading}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-cyan-500 to-sky-500 text-stone-950 text-[11px] font-black uppercase tracking-widest shadow-md shadow-cyan-500/25 hover:brightness-105 active:scale-[0.99] disabled:opacity-50 transition-all">
                  {loading ? 'Working…'
                    : authTab === 'login' ? 'Sign in'
                    : authTab === 'register' ? 'Create free account'
                    : resetToken ? 'Set new password' : 'Find my account'}
                </button>
              </form>

              <div className="w-full flex items-center gap-4" aria-hidden="true">
                <span className="flex-1 h-px bg-stone-200 dark:bg-white/10" />
                <span className="text-[9px] font-black uppercase tracking-widest text-stone-400">or</span>
                <span className="flex-1 h-px bg-stone-200 dark:bg-white/10" />
              </div>
              <button onClick={handleGoogle} disabled={loading}
                className="w-full py-3.5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-300 dark:border-white/10 text-stone-800 dark:text-white text-[11px] font-black uppercase tracking-widest hover:bg-black/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-50 transition-colors flex items-center justify-center gap-2.5">
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2 3.8-5 3.8-8.9z" />
                  <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-.1.1-3.6 2.8v.1C3.5 21.3 7.5 24 12 24z" />
                  <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.1-.1-3.6-2.8-.1.1C.5 8.6 0 10.2 0 12s.5 3.4 1.4 4.9l3.8-2.5z" />
                  <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.7 1.4 6.6l3.8 2.9c1-2.9 3.7-4.8 6.8-4.8z" />
                </svg>
                {googleBusy ? 'Opening Google…' : 'Continue with Google'}
              </button>

              {canBrowserLogin && (
                <>
                  <div className="w-full flex items-center gap-4" aria-hidden="true">
                    <span className="flex-1 h-px bg-stone-200 dark:bg-white/10" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-stone-400">or</span>
                    <span className="flex-1 h-px bg-stone-200 dark:bg-white/10" />
                  </div>
                  <button onClick={handleBrowserLogin} disabled={loading}
                    className="w-full py-3.5 rounded-2xl border border-stone-300 dark:border-white/10 text-stone-700 dark:text-stone-200 text-[11px] font-black uppercase tracking-widest hover:bg-black/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-50 transition-colors">
                    {browserLoginBusy ? 'Waiting for approval…' : 'Sign in via desktop browser'}
                  </button>
                </>
              )}

              <p className="text-[10px] font-bold text-stone-400">By continuing you agree to our Terms & Privacy policy.</p>
            </div>
          ) : (
            <div className="w-full space-y-8">
              {/* Profile card */}
              <div className="p-8 rounded-[32px] bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] shadow-sm flex flex-col items-center gap-3 text-center">
                <div className="relative">
                  <span className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-cyan-500 to-sky-500 flex items-center justify-center shadow-lg ring-4 ring-cyan-500/15">
                    {user.avatar
                      ? <img src={user.avatar} className="w-full h-full object-cover" alt="" />
                      : <span className="text-3xl font-black text-stone-950">{(user.name?.[0] || 'U').toUpperCase()}</span>}
                  </span>
                  <span className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-500 border-4 border-white dark:border-stone-900 rounded-full" title="Signed in" />
                </div>
                <h3 className="text-xl font-black text-stone-900 dark:text-white">{user.name}</h3>
                <p className="text-xs font-mono text-stone-500">{user.email || user.phone}</p>
                {user.phone && user.email && <p className="text-[11px] font-mono text-stone-400">{user.phone}</p>}
                <span className="px-4 py-1 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 rounded-full text-[10px] font-black uppercase tracking-widest border border-cyan-500/25">Free forever</span>
              </div>

              {/* Account details */}
              <div className="space-y-3">
                <label className={labelCls}><i className="fa-solid fa-user-pen text-cyan-500" /> Account details</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="text" value={editName} maxLength={60} onChange={e => setEditName(e.target.value)} placeholder="Display name" aria-label="Display name" className={inputCls} />
                  <input type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder={user.email ? 'Add phone number' : 'Phone number'} aria-label="Phone number" className={inputCls} />
                </div>
                {profileMsg && <p role="status" className={`text-xs font-bold px-1 ${profileMsg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{profileMsg.text}</p>}
                <button onClick={handleSaveProfile} disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-br from-cyan-500 to-sky-500 text-stone-950 text-[10px] font-black uppercase tracking-widest hover:brightness-105 disabled:opacity-50 transition-all shadow-sm">
                  {loading ? 'Saving…' : 'Save details'}
                </button>
              </div>

              {/* Set password */}
              <div className="space-y-3">
                <label className={labelCls}><i className="fa-solid fa-key text-cyan-500" /> Password</label>
                <p className="text-[11px] text-stone-500 dark:text-stone-400 px-1">Set a password to sign in with your email or phone — including from the desktop app.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="password" value={newPw} autoComplete="new-password" onChange={e => setNewPw(e.target.value)} placeholder="New password (min 8 chars)" aria-label="New password" className={inputCls} />
                  <input type="password" value={confirmPw} autoComplete="new-password" onChange={e => setConfirmPw(e.target.value)} placeholder="Confirm password" aria-label="Confirm password" className={inputCls} />
                </div>
                {pwMsg && <p role="status" className={`text-xs font-bold px-1 ${pwMsg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{pwMsg.text}</p>}
                <button onClick={handleSetPassword} disabled={loading || !newPw}
                  className="px-5 py-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-[10px] font-black uppercase tracking-widest hover:opacity-90 disabled:opacity-40 transition-opacity">
                  Save password
                </button>
              </div>

              {/* Memory */}
              <div className="space-y-3">
                <div className="flex justify-between items-center px-1">
                  <label className={labelCls}><i className="fa-solid fa-memory text-cyan-500" /> Memory</label>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-mono ${memory.length > MEMORY_MAX_LENGTH ? 'text-cyan-600' : 'text-stone-400'}`} aria-live="polite">{memory.length} / {MEMORY_MAX_LENGTH}</span>
                    <button onClick={handleSaveMemory} disabled={loading} className="text-[10px] font-bold text-cyan-600 dark:text-cyan-300 hover:underline">{loading ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
                <textarea value={memory} onChange={e => setMemory(e.target.value)} maxLength={MEMORY_MAX_LENGTH} rows={5}
                  className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-white/10 rounded-2xl p-4 text-sm resize-none outline-none focus:border-cyan-500/60 transition-colors custom-scrollbar"
                  placeholder="Tell Orin what to remember about you — it is added to every conversation…" />
              </div>

              {/* Activity */}
              <div className="space-y-3">
                <h4 className={labelCls}>Activity</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-5 rounded-2xl bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] text-center">
                    <span className="block text-2xl font-black tabular-nums text-stone-900 dark:text-white">{conversationsCount}</span>
                    <span className="block text-[9px] font-black uppercase tracking-widest text-stone-400 mt-1">Chats</span>
                  </div>
                  <div className="p-5 rounded-2xl bg-white dark:bg-stone-900 border border-black/[0.05] dark:border-white/[0.06] text-center">
                    <span className="block text-2xl font-black tabular-nums text-stone-900 dark:text-white">{usage ? usage.images : user.dailyUsage.images + user.dailyUsage.videos}</span>
                    <span className="block text-[9px] font-black uppercase tracking-widest text-stone-400 mt-1">Images created</span>
                  </div>
                </div>
              </div>

              {/* Danger zone */}
              <div className="pt-4 border-t border-black/[0.05] dark:border-white/[0.06] space-y-3">
                <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest px-1">Danger zone</h4>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={onClearHistory} className="py-4 rounded-2xl bg-stone-100 dark:bg-stone-900 hover:bg-red-500 hover:text-white text-[10px] font-black uppercase tracking-widest text-stone-500 dark:text-stone-400 transition-colors">
                    Delete history
                  </button>
                  <button onClick={handleLogout} className="py-4 rounded-2xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors">
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountSettings;
