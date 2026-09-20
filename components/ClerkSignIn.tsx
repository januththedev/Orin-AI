import React, { useEffect, useRef, useState } from 'react';
import { SignedOut, SignIn, useUser, useAuth } from '@clerk/clerk-react';
import { firebaseService } from '../services/firebaseService';

/**
 * Clerk sign-in (email/phone + password, verification codes, magic links —
 * all driven by the Clerk dashboard). On Clerk sign-in, exchanges the Clerk
 * session for a Firebase custom token so quotas, sync, device flow, and the
 * PC app keep working unchanged.
 *
 * Rendered only when the parent confirms a publishable key exists (so this
 * file's Clerk hooks always run inside ClerkProvider) and no Firebase
 * session is active yet.
 */
function ClerkInner() {
  const { isSignedIn, user } = useUser();
  const { getToken, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exchangedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !user) return;
    if (exchangedFor.current === user.id) return;
    exchangedFor.current = user.id;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error('No Clerk session token.');
        const res = await fetch('/api/auth/clerk', {
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
        try { await signOut(); } catch {}
      } finally {
        setBusy(false);
      }
    })();
  }, [isSignedIn, user, getToken, signOut]);

  return (
    <div className="w-full">
      <SignedOut>
        <SignIn
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'w-full shadow-none border border-stone-300 dark:border-white/10 rounded-2xl',
            },
          }}
        />
        {busy && <p className="text-xs font-bold text-stone-500 mt-2">Linking your Orin account…</p>}
        {error && <p role="status" className="text-xs font-bold text-red-500 mt-2">{error}</p>}
      </SignedOut>
    </div>
  );
}

const ClerkSignIn: React.FC<{ firebaseSignedIn: boolean; clerkEnabled: boolean }> = ({
  firebaseSignedIn,
  clerkEnabled,
}) => {
  if (!clerkEnabled || firebaseSignedIn) return null;
  return <ClerkInner />;
};

export default ClerkSignIn;
