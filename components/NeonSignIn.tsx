import React, { useEffect, useRef, useState } from 'react';
import { firebaseService } from '../services/firebaseService';
import { getNeonClient, neonAuthUrl } from '../services/neonClient';

/**
 * Neon Auth Google sign-in. No SDK UI kit — one Google button driving the
 * standard better-auth social flow, then the session token is exchanged for
 * a Firebase custom token so quotas, sync, device flow, and the PC app keep
 * working unchanged.
 *
 * Rendered only when VITE_NEON_AUTH_URL is set and no Firebase session is
 * active yet.
 */
function NeonInner({ client }: { client: NonNullable<ReturnType<typeof getNeonClient>> }) {
  const { data: session, isPending } = client.useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exchangedFor = useRef<string | null>(null);

  useEffect(() => {
    const user = (session as any)?.user;
    if (!user) return;
    const key = user.id || user.email || 'neon-user';
    if (exchangedFor.current === key) return;
    exchangedFor.current = key;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const s = session as any;
        const token =
          s?.session?.token || s?.token || s?.accessToken || s?.user?.token || null;
        if (!token || typeof token !== 'string') {
          throw new Error('Signed in, but no session token was issued. Reload and try again.');
        }
        const res = await fetch('/api/auth/neon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'exchange', token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Account link failed.');
        await firebaseService.signInWithCustom(data.customToken);
        window.location.hash = 'chat';
      } catch (err: any) {
        setError(err?.message || 'Sign-in link failed.');
        exchangedFor.current = null;
        try { await client.signOut(); } catch {}
      } finally {
        setBusy(false);
      }
    })();
  }, [session, client]);

  const startGoogle = async () => {
    setError(null);
    try {
      await client.signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}/#account`,
      });
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed.');
    }
  };

  if ((session as any)?.user) return null;

  return (
    <div className="w-full">
      <button
        onClick={() => void startGoogle()}
        disabled={isPending}
        className="w-full py-3.5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-300 dark:border-white/10 text-stone-800 dark:text-white text-[11px] font-black uppercase tracking-widest hover:bg-black/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-50 transition-colors flex items-center justify-center gap-2.5"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2 3.8-5 3.8-8.9z" />
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-.1.1-3.6 2.8v.1C3.5 21.3 7.5 24 12 24z" />
          <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.1-.1-3.6-2.8-.1.1C.5 8.6 0 10.2 0 12s.5 3.4 1.4 4.9l3.8-2.5z" />
          <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.7 1.4 6.6l3.8 2.9c1-2.9 3.7-4.8 6.8-4.8z" />
        </svg>
        Continue with Google
      </button>
      {busy && <p className="text-xs font-bold text-stone-500 mt-2">Linking your Orin account…</p>}
      {error && <p role="status" className="text-xs font-bold text-red-500 mt-2">{error}</p>}
    </div>
  );
}

const NeonSignIn: React.FC<{ firebaseSignedIn: boolean }> = ({ firebaseSignedIn }) => {
  const client = getNeonClient();
  if (!client || firebaseSignedIn || !neonAuthUrl()) return null;
  return <NeonInner client={client} />;
};

export async function neonSignOut() {
  try {
    await getNeonClient()?.signOut();
  } catch {}
}

export default NeonSignIn;
