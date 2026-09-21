/**
 * Google sign-in button (Google Identity Services) — the visible Google
 * sign-in on the website. Google verifies the user; our backend
 * (POST /api/auth/google {action:'signin'}) verifies the credential with
 * Google, links the Orin identity in Neon, and returns an Orin session.
 * No Firebase, no Clerk, no third-party auth SDK.
 */
import React, { useEffect, useRef, useState } from 'react';
import { sessionService } from '../services/sessionService';

declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Google sign-in.')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
    document.head.appendChild(s);
  });
}

const NeonSignIn: React.FC = () => {
  const btnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientId = (import.meta as any)?.env?.VITE_GOOGLE_CLIENT_ID || '';

  useEffect(() => {
    if (!clientId || !btnRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        await loadGis();
        if (cancelled || !btnRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp: any) => {
            if (!resp?.credential) return;
            setBusy(true);
            setError(null);
            try {
              await sessionService.signInWithGoogle(resp.credential);
              window.location.hash = 'chat';
            } catch (err: any) {
              setError(err?.message || 'Google sign-in failed.');
            } finally {
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'signin_with',
        });
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load Google sign-in.');
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (!clientId) {
    return (
      <p className="text-[11px] font-bold text-stone-400">
        Google sign-in is not configured yet (VITE_GOOGLE_CLIENT_ID).
      </p>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <div ref={btnRef} className="flex justify-center min-h-[44px]" />
      {busy && <p className="text-xs font-bold text-stone-500">Signing you in…</p>}
      {error && <p role="status" className="text-xs font-bold text-red-500">{error}</p>}
    </div>
  );
};

export default NeonSignIn;
