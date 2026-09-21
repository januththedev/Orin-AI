/**
 * DeviceAuthPage — approves a desktop-app login from the browser (#device-auth?code=XXXX-XXXX).
 * Flow: user clicks "Sign in" in the Orin desktop app → system browser opens HERE
 * → user signs in (if needed) → taps Approve → the app signs in automatically.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { sessionService } from '../services/sessionService';
import { UserAccount } from '../types';

interface DeviceAuthPageProps {
  onClose: () => void;
  user: UserAccount | null;
}

type Stage = 'reading' | 'need-signin' | 'confirm' | 'approving' | 'approved' | 'denied' | 'error';

const DeviceAuthPage: React.FC<DeviceAuthPageProps> = ({ onClose, user }) => {
  const [stage, setStage] = useState<Stage>('reading');
  const [message, setMessage] = useState<string>('');
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState<Date | null>(null);
  const [deciding, setDeciding] = useState(false);

  const userCode = (() => {
    const hash = window.location.hash || '';
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    return new URLSearchParams(qs).get('code') || '';
  })();

  const lookup = useCallback(async () => {
    if (!user) {
      // Remember the approval link so App can resume here right after sign-in.
      sessionStorage.setItem('device-auth-return', window.location.hash);
      setStage('need-signin'); return;
    }
    setStage('reading');
    try {
      const token = await sessionService.getIdToken();
      const res = await fetch('/api/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'lookup', user_code: userCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error || 'Could not find that login request.'); setStage('error'); return; }
      setDeviceCode(data.device_code);
      const ra = data.requested_at;
      setRequestedAt(typeof ra === 'number' ? new Date(ra) : (ra?.toDate ? ra.toDate() : null));
      setStage('confirm');
    } catch {
      setMessage('Network error. Check your connection and retry.');
      setStage('error');
    }
  }, [user, userCode]);

  useEffect(() => {
    if (!userCode) { setMessage('No code found in the link. Start again from the Orin desktop app.'); setStage('error'); return; }
    lookup();
  }, [userCode, lookup]);

  const decide = async (approve: boolean) => {
    if (!deviceCode || deciding) return;
    setDeciding(true);
    setStage('approving');
    try {
      const token = await sessionService.getIdToken();
      const res = await fetch('/api/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'approve', device_code: deviceCode, deny: !approve }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error || 'Approval failed.'); setStage('error'); return; }
      setStage(approve ? 'approved' : 'denied');
    } catch {
      setMessage('Network error. Try again.');
      setStage('error');
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <div className="max-w-md w-full space-y-8">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 bg-indigo-500 blur-[50px] opacity-25 rounded-full" />
          <div className="w-20 h-20 bg-white dark:bg-slate-900 rounded-[24px] border border-slate-100 dark:border-white/10 shadow-xl flex items-center justify-center relative">
            <i className="fa-solid fa-desktop text-3xl text-slate-800 dark:text-white" />
          </div>
        </div>

        {stage === 'need-signin' && (
          <>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Sign in first</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The Orin desktop app is waiting for approval of code <span className="font-mono font-black text-indigo-500">{userCode}</span>.
              Sign in here, then this page will continue automatically.
            </p>
            <button onClick={() => { window.location.hash = 'account'; }}
              className="w-full py-4 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-500 transition-colors">
              Sign in to approve
            </button>
          </>
        )}

        {(stage === 'reading') && (
          <div className="flex flex-col items-center gap-4">
            <i className="fa-solid fa-circle-notch animate-spin text-3xl text-indigo-500" />
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Checking login request…</p>
          </div>
        )}

        {stage === 'confirm' && (
          <>
            <div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Approve this device?</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
                The Orin desktop app wants to sign in as <span className="font-bold">{user?.name || user?.email}</span>.
                Code: <span className="font-mono font-black text-indigo-500">{userCode}</span>
                {requestedAt && <span className="block text-xs mt-1 text-slate-400">requested {requestedAt.toLocaleTimeString()}</span>}
              </p>
              <p className="text-[11px] text-slate-400 mt-2">
                Only approve if YOU clicked “Sign in” in the Orin desktop app just now.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => decide(false)} disabled={deciding}
                className="flex-1 py-4 rounded-2xl bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-widest hover:bg-red-500/10 hover:text-red-500 transition-colors disabled:opacity-40">
                Deny
              </button>
              <button onClick={() => decide(true)} disabled={deciding}
                className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg shadow-indigo-500/20">
                {deciding ? <i className="fa-solid fa-circle-notch animate-spin" /> : <i className="fa-solid fa-shield-halved" />}
                {deciding ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </>
        )}

        {stage === 'approved' && (
          <>
            <i className="fa-solid fa-circle-check text-5xl text-emerald-500" />
            <h1 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-tight">Device approved</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">You can close this tab — the desktop app is signing in now.</p>
          </>
        )}

        {stage === 'denied' && (
          <>
            <i className="fa-solid fa-ban text-5xl text-red-500" />
            <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Request denied</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">The desktop app was not signed in.</p>
          </>
        )}

        {stage === 'error' && (
          <>
            <i className="fa-solid fa-triangle-exclamation text-5xl text-amber-500" />
            <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Can't approve yet</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
            <button onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500">
              Retry
            </button>
          </>
        )}

        <button onClick={onClose} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          Back to Orin
        </button>
      </div>
    </div>
  );
};

export default DeviceAuthPage;
