import React, { useEffect, useRef, useState } from 'react';
import { SignIn, useUser, useStackApp } from '@stackframe/react';
import { firebaseService } from '../services/firebaseService';
/**
 * Neon Auth sign-in (Google + any dashboard-enabled method: email/phone +
 * password, codes, links — all driven by the Neon/Stack dashboard). On
 * sign-in, exchanges the Neon access token for a Firebase custom token so
 * quotas, sync, device flow, and the PC app keep working unchanged.
 *
 * Rendered only when the parent confirms Stack is configured (so these
 * hooks always run inside StackProvider) and no Firebase session is active.
 */
function NeonInner() {
  const user = useUser();
  const stackApp = useStackApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exchangedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (exchangedFor.current === user.id) return;
    exchangedFor.current = user.id;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const token = await stackApp.getAccessToken();
        if (!token) throw new Error('No Neon session token.');
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
        try { await (user as any)?.signOut?.(); } catch {}
      } finally {
        setBusy(false);
      }
    })();
  }, [user, stackApp]);

  return (
    <div className="w-full">
      <SignIn />
      {busy && <p className="text-xs font-bold text-stone-500 mt-2">Linking your Orin account…</p>}
      {error && <p role="status" className="text-xs font-bold text-red-500 mt-2">{error}</p>}
    </div>
  );
}

const NeonSignIn: React.FC<{ firebaseSignedIn: boolean; stackEnabled: boolean }> = ({
  firebaseSignedIn,
  stackEnabled,
}) => {
  if (!stackEnabled || firebaseSignedIn) return null;
  return <NeonInner />;
};

function StackSignOutBridgeInner() {
  const stackApp = useStackApp();
  useEffect(() => {
    (window as any).__orinStackSignOut = () => stackApp.signOut();
    return () => {
      delete (window as any).__orinStackSignOut;
    };
  }, [stackApp]);
  return null;
}

/** Mount once when Stack is configured so sign-out covers both sessions. */
export function StackSignOutBridge({ stackEnabled }: { stackEnabled: boolean }) {
  if (!stackEnabled) return null;
  return <StackSignOutBridgeInner />;
}

export async function stackSignOut() {
  try {
    await (window as any).__orinStackSignOut?.();
  } catch {}
}

export default NeonSignIn;
