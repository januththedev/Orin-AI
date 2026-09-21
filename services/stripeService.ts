/**
 * Calls the backend to create a Stripe Checkout Session and returns the redirect URL.
 * Sends the caller's Orin session token — the backend attributes the session to the
 * authenticated user only (never to a client-supplied userId).
 */
import { sessionService } from './sessionService';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

export async function createCheckoutSession(params: {
  planKey: string;
  userId: string;
  userEmail?: string | null;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ url: string } | { error: string }> {
  const token = await sessionService.getIdToken();
  const res = await fetch(`${API_BASE}/api/create-checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      planKey: params.planKey,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || res.statusText || 'Checkout failed' };
  if (!data.url) return { error: data.error || 'No checkout URL' };
  return { url: data.url };
}
