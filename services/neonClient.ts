import { createAuthClient } from 'better-auth/react';

/**
 * Single Neon Auth client for the SPA (module singleton — hooks share one
 * session store). baseURL is the project's Neon Auth URL
 * (VITE_NEON_AUTH_URL). Null when unconfigured — callers render nothing.
 */
let client: ReturnType<typeof createAuthClient> | null | undefined;

export function getNeonClient() {
  if (client !== undefined) return client;
  const baseURL = (import.meta as any)?.env?.VITE_NEON_AUTH_URL || '';
  client = baseURL ? createAuthClient({ baseURL }) : null;
  return client;
}

export function neonAuthUrl(): string {
  return (import.meta as any)?.env?.VITE_NEON_AUTH_URL || '';
}
