/**
 * sessionService — the ONLY auth/data client in the app. Replaces the old
 * Firebase service 1:1 at the call-site level (same method names), but every
 * method talks to our own Neon-backed API with an Orin session token:
 *
 *   - Password accounts → POST /api/auth/password (scrypt in Neon)
 *   - Google sign-in    → POST /api/auth/google {action:'signin'} (GIS token,
 *                         verified with Google, linked in Neon)
 *   - Session/profile   → POST /api/auth/session
 *   - History/memory    → /api/history
 *   - Admin             → POST /api/admin
 *
 * The session token + minimal profile live in localStorage (mobile-safe,
 * unlike Firebase's indexedDB persistence that iOS Safari wipes). No
 * Firebase, no Clerk, no third-party auth SDK — nothing leaves orinai.org
 * except the Google button's own verification with Google.
 */
import { Conversation, UserAccount, UserRole, SignupRequest, SiteMetrics, ApiKeyDef, conversationHasUserMessage } from "../types";

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

const TOKEN_KEY = 'orin_session_token';
const PROFILE_KEY = 'orin_session_user';

type AuthListener = (user: SessionUser | null) => void;

function readToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function readProfile(): SessionUser | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.uid) return null;
    return { uid: String(p.uid), email: p.email ?? null, displayName: p.displayName ?? null, photoURL: p.photoURL ?? null };
  } catch { return null; }
}

class SessionService {
  private listeners = new Set<AuthListener>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === TOKEN_KEY || e.key === PROFILE_KEY) this.emit(readProfile());
      });
    }
  }

  private emit(user: SessionUser | null) {
    for (const cb of this.listeners) {
      try { cb(user); } catch {}
    }
  }

  private storeSession(token: string, user: { id: string; name?: string; email?: string; avatar?: string | null }): SessionUser {
    const profile: SessionUser = {
      uid: user.id,
      email: user.email ?? null,
      displayName: user.name ?? (user.email ? user.email.split('@')[0] : null),
      photoURL: user.avatar ?? null,
    };
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {}
    this.emit(profile);
    return profile;
  }

  onAuthStateChanged(callback: (user: SessionUser | null) => void): () => void {
    this.listeners.add(callback);
    // Fire the current state on subscribe (synchronously is fine — App handles it).
    try { callback(readProfile()); } catch {}
    return () => { this.listeners.delete(callback); };
  }

  currentUser(): SessionUser | null {
    return readProfile();
  }

  /** The Orin session token (Bearer for all /api calls). Empty when signed out. */
  async getIdToken(): Promise<string> {
    return readToken();
  }

  /** Compat stub — Google redirect flow is gone (GIS button signs in in place). */
  async getRedirectResult(): Promise<{ credential: null; error: string | null }> {
    return { credential: null, error: null };
  }

  async logout(): Promise<void> {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PROFILE_KEY);
    } catch {}
    this.emit(null);
  }

  // ─── Password accounts ────────────────────────────────────────────────────

  /** POST /api/auth/password with the caller's Bearer token (for set-password). */
  private async authApi(action: string, body: Record<string, unknown>): Promise<any> {
    const token = readToken();
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  /** Sign in with email-or-phone + password. */
  async loginWithPassword(identifier: string, password: string): Promise<SessionUser | null> {
    const data = await this.authApi('login', { identifier, password });
    if (!data.sessionToken) throw new Error('Sign-in failed. Try again.');
    return this.storeSession(data.sessionToken, data.user || {});
  }

  /** Register with name + email + phone + password. */
  async registerWithPassword(name: string, email: string, phone: string, password: string): Promise<SessionUser | null> {
    const data = await this.authApi('register', { name, email, phone, password });
    if (!data.sessionToken) throw new Error('Sign-up failed. Try again.');
    return this.storeSession(data.sessionToken, data.user || {});
  }

  /** Password reset step 1 — verify identity, get a short-lived reset token. */
  async requestPasswordReset(name: string, email: string, phone: string): Promise<string> {
    const data = await this.authApi('reset-verify', { name, email, phone });
    return data.resetToken;
  }

  /** Password reset step 2 — consume the token and set the new password. */
  async confirmPasswordReset(resetToken: string, password: string): Promise<void> {
    await this.authApi('reset-confirm', { resetToken, password });
  }

  /** Set or change the password on the CURRENTLY signed-in account. */
  async setPassword(password: string): Promise<void> {
    await this.authApi('set-password', { password });
  }

  // ─── Google + session handoff ─────────────────────────────────────────────

  /** Sign in from a Google Identity Services credential (verified server-side). */
  async signInWithGoogle(credential: string): Promise<SessionUser | null> {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signin', credential }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Google sign-in failed.');
    if (!data.sessionToken) throw new Error('Google sign-in failed. Try again.');
    return this.storeSession(data.sessionToken, data.user || {});
  }

  /**
   * Adopt an already-minted Orin session token — used by the desktop
   * device-flow (browser approval) and the Electron browserLogin handoff.
   */
  async signInWithSession(sessionToken: string): Promise<SessionUser | null> {
    if (!sessionToken) throw new Error('Sign-in failed. Try again.');
    const res = await fetch('/api/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ action: 'sync' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign-in failed. Try again.');
    return this.storeSession(sessionToken, { id: data.id, name: data.name, email: data.email, avatar: data.avatar });
  }

  /** Resolve the session into the full UserAccount (creates the Neon row on first login). */
  async syncUserSession(_uid?: string, email?: string, photoURL?: string | null): Promise<UserAccount> {
    const token = readToken();
    if (!token) throw new Error('Not signed in');
    const profile = readProfile();
    const res = await fetch('/api/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'sync',
        email: email || profile?.email || '',
        name: profile?.displayName || '',
        avatar: photoURL ?? profile?.photoURL ?? null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Sync failed (${res.status})`);
    return data as UserAccount;
  }

  // ─── History / memory / profile / usage (→ /api/history) ──────────────────

  private async historyApi(action: string, body: Record<string, unknown> = {}): Promise<any> {
    const token = readToken();
    const res = await fetch('/api/me', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  private async historyGet(): Promise<{ history: any[] | null; memory: string }> {
    const token = readToken();
    const res = await fetch('/api/me', {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return { history: Array.isArray(data.history) ? data.history : null, memory: data.memory || '' };
  }

  async saveHistory(_uid: string, history: Conversation[], deletedIds: string[] = []) {
    try {
      await this.historyApi('save', { history, deletedIds });
    } catch {
      // Network hiccup; sync retries on the next change.
    }
  }

  async getHistory(_uid?: string): Promise<Conversation[] | null> {
    try {
      const { history } = await this.historyGet();
      if (!history) return null;
      return history.map((c: any) => ({
        ...c,
        id: c.id ?? String(Date.now()),
        title: c.title ?? 'Chat',
        mode: c.mode ?? 'chat',
        timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
        messages: (c.messages || []).map((m: any) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        })),
      }));
    } catch {
      return null;
    }
  }

  async getUserMemory(_uid?: string): Promise<string> {
    try {
      const { memory } = await this.historyGet();
      return memory || '';
    } catch {
      return '';
    }
  }

  async updateUserMemory(_uid: string, memory: string) {
    await this.historyApi('memory', { memory });
  }

  /** Update display name / phone on the user's own profile row. */
  async updateUserProfile(_uid: string, data: { name?: string; phone?: string }): Promise<void> {
    await this.historyApi('profile', data);
  }

  async getUsage(_uid?: string): Promise<{ text: number; images: number; videos: number }> {
    try {
      const data = await this.historyApi('usage-get');
      return { text: data.text ?? 0, images: data.images ?? 0, videos: data.videos ?? 0 };
    } catch {
      return { text: 0, images: 0, videos: 0 };
    }
  }

  // Orin AI is completely free — no usage caps client-side; the API layer
  // keeps its own abuse protection.
  async checkLimit(_uid: string, _type: 'text' | 'images' | 'videos'): Promise<boolean> {
    return false;
  }

  async incrementUsage(_uid: string, type: 'text' | 'images' | 'videos') {
    try {
      await this.historyApi('usage-incr', { type });
    } catch {
      // Never blocks chat.
    }
  }

  // ─── Admin (→ /api/admin) ─────────────────────────────────────────────────

  /** POST /api/admin with the caller's session token. */
  private async adminApi(action: string, body: Record<string, unknown>): Promise<any> {
    const token = readToken();
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async submitSignupRequest(email: string, reason: string): Promise<void> {
    await this.adminApi('create-pending-signup', { email, reason });
  }

  async approveUser(uid: string, role: UserRole): Promise<void> {
    await this.adminApi('approve-user', { targetUid: uid, role, approved: true });
  }

  async generateApiKey(note: string): Promise<string> {
    const data = await this.adminApi('generate-api-key', { note });
    return data.apiKey ?? '';
  }

  async processOCR(imageUrl: string, lang: 'en' | 'si'): Promise<any> {
    return this.adminApi('ocr-process', { imageUrl, lang });
  }

  async getPendingRequests(): Promise<SignupRequest[]> {
    try {
      const data = await this.adminApi('list-pending', {});
      return (data.requests || []).map((d: any) => ({ id: d.id, ...d }));
    } catch {
      return [];
    }
  }

  async getApiKeys(): Promise<ApiKeyDef[]> {
    try {
      const data = await this.adminApi('list-keys', {});
      return data.keys || [];
    } catch {
      return [];
    }
  }

  async getSiteMetrics(): Promise<SiteMetrics> {
    const fallback: SiteMetrics = { totalUsers: 0, activeToday: 0, aiRequests: 0, serverStatus: 'online', lastBackup: new Date() };
    try {
      const data = await this.adminApi('metrics', {});
      return {
        totalUsers: data.totalUsers || 0,
        activeToday: data.activeToday || 0,
        aiRequests: data.aiRequests || 0,
        serverStatus: data.serverStatus || 'online',
        lastBackup: data.lastBackup ? new Date(data.lastBackup) : new Date(),
      };
    } catch {
      return fallback;
    }
  }
}

export const sessionService = new SessionService();
// Alias kept so any missed import still resolves during the migration.
export const firebaseService = sessionService;
export type { Conversation };
export { conversationHasUserMessage };
