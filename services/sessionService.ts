import { Conversation, UserAccount, UserRole, SignupRequest, SiteMetrics, ApiKeyDef, conversationHasUserMessage } from "../types";

export interface SessionUser { uid: string; email: string | null; displayName: string | null; photoURL: string | null; }
type AuthListener = (user: SessionUser | null) => void;
let currentProfile: SessionUser | null = null;
const listeners = new Set<AuthListener>();
function emit(user: SessionUser | null) { currentProfile = user; for (const listener of listeners) { try { listener(user); } catch {} } }
function csrf() { const match = /(?:^|;\s*)orin_csrf=([^;]+)/.exec(document.cookie); return match ? decodeURIComponent(match[1]) : ''; }
async function request(path: string, init: RequestInit = {}) { const url = new URL(path, window.location.origin); if (url.origin !== window.location.origin) throw new Error('Cross-origin API request blocked'); const headers = new Headers(init.headers); if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json'); if (init.method && init.method !== 'GET') headers.set('x-orin-csrf', csrf()); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000); try { const response = await fetch(url, { ...init, headers, credentials: 'include', signal: controller.signal }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data?.error?.message || data?.error || `Request failed (${response.status})`); return data; } finally { clearTimeout(timer); } }
function toProfile(user: { id: string; name?: string; email?: string; avatar?: string | null }): SessionUser { return { uid: user.id, email: user.email ?? null, displayName: user.name ?? user.email?.split('@')[0] ?? null, photoURL: user.avatar ?? null }; }
class SessionService {
  onAuthStateChanged(callback: AuthListener) { listeners.add(callback); callback(currentProfile); return () => listeners.delete(callback); }
  currentUser() { return currentProfile; }
  async getIdToken() { return ''; }
  async getRedirectResult() { return { credential: null, error: null }; }
  async bootstrap() { try { const data = await request('/api/me'); if (data.csrf === undefined) { const me = await request('/api/me'); emit(toProfile(me.user || me)); return me.user || me; } emit(toProfile(data.user || data)); return data.user || data; } catch { emit(null); return null; } }
  async loginWithPassword(identifier: string, password: string) { const data = await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'login', identifier, password }) }); const user = toProfile(data.user); emit(user); return user; }
  async registerWithPassword(name: string, email: string, phone: string, password: string) { const data = await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'register', name, email, phone, password }) }); const user = toProfile(data.user); emit(user); return user; }
  async signInWithNeonToken(token: string) { const data = await request('/api/auth/neon', { method: 'POST', body: JSON.stringify({ action: 'exchange', token }) }); const user = toProfile(data.user); emit(user); return user; }
  async signInWithSession(sessionToken: string) { return this.signInWithNeonToken(sessionToken); }
  async logout() { try { await request('/api/auth/logout', { method: 'POST' }); } finally { emit(null); } }
  async requestPasswordReset(name: string, email: string, phone: string) { const data = await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'reset-verify', name, email, phone }) }); return data.resetToken; }
  async confirmPasswordReset(resetToken: string, password: string) { await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'reset-confirm', resetToken, password }) }); }
  async setPassword(password: string) { await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'set-password', password }) }); }
  async mcpCreate(name: string, scopes: string[]) { return request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'mcp-create', name, scopes }) }); }
  async mcpList() { const data = await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'mcp-list' }) }); return data.tokens || []; }
  async mcpRevoke(id: string) { await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'mcp-revoke', id }) }); }
  async mcpRename(id: string, name: string) { await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'mcp-rename', id, name }) }); }
  async mcpRotate(id: string) { return request('/api/auth/password', { method: 'POST', body: JSON.stringify({ action: 'mcp-rotate', id }) }); }
  async syncUserSession(uid?: string, email?: string, photoURL?: string | null): Promise<UserAccount> { return request('/api/me', { method: 'POST', body: JSON.stringify({ action: 'sync', uid, email, photoURL }) }); }
  async saveHistory(uid: string, history: Conversation[], deletedIds: string[] = []) { await request('/api/me', { method: 'POST', body: JSON.stringify({ action: 'save', history, deletedIds }) }); }
  async getHistory(uid?: string): Promise<Conversation[] | null> { try { const data = await request('/api/me'); return (data.history || []).map((item: any) => ({ ...item, id: item.id ?? String(Date.now()), title: item.title ?? 'Chat', mode: item.mode ?? 'chat', timestamp: item.timestamp ? new Date(item.timestamp) : new Date(), messages: (item.messages || []).map((message: any) => ({ ...message, timestamp: message.timestamp ? new Date(message.timestamp) : new Date() })) })); } catch { return null; } }
  async getUserMemory(_uid?: string) { try { const data = await request('/api/me'); return data.memory || ''; } catch { return ''; } }
  async updateUserMemory(uid: string, memory: string) { await request('/api/me', { method: 'POST', body: JSON.stringify({ action: 'memory', memory }) }); }
  async updateUserProfile(uid: string, data: { name?: string; phone?: string }) { await request('/api/me', { method: 'POST', body: JSON.stringify({ action: 'profile', ...data }) }); }
  async getUsage(_uid?: string) { try { return await request('/api/me', { method: 'POST', body: JSON.stringify({ action: 'usage-get' }) }); } catch { return { text: 0, images: 0, videos: 0 }; } }
  async checkLimit(_uid: string, _type: 'text' | 'images' | 'videos') { return false; }
  async incrementUsage(_uid: string, type: 'text' | 'images' | 'videos') { await request('/api/me', { method: 'POST', body: JSON.stringify({ action: 'usage-incr', type }) }); }
  private async admin(action: string, body: Record<string, unknown> = {}) { return request('/api/admin', { method: 'POST', body: JSON.stringify({ action, ...body }) }); }
  async submitSignupRequest(email: string, reason: string) { await this.admin('create-pending-signup', { email, reason }); }
  async approveUser(uid: string, role: UserRole) { await this.admin('approve-user', { targetUid: uid, role, approved: true }); }
  async generateApiKey(note: string) { const data = await this.admin('generate-api-key', { note }); return data.apiKey ?? ''; }
  async processOCR(imageUrl: string, lang: 'en' | 'si') { return this.admin('ocr-process', { imageUrl, lang }); }
  async getPendingRequests() { try { const data = await this.admin('list-pending'); return data.requests || []; } catch { return []; } }
  async getApiKeys() { try { const data = await this.admin('list-keys'); return data.keys || []; } catch { return []; } }
  async getSiteMetrics(): Promise<SiteMetrics> { try { const data = await this.admin('metrics'); return { totalUsers: data.totalUsers || 0, activeToday: data.activeToday || 0, aiRequests: data.aiRequests || 0, serverStatus: data.serverStatus || 'online', lastBackup: data.lastBackup ? new Date(data.lastBackup) : new Date() }; } catch { return { totalUsers: 0, activeToday: 0, aiRequests: 0, serverStatus: 'online', lastBackup: new Date() }; } }
}
export const sessionService = new SessionService();
export const firebaseService = sessionService;
export type { Conversation };
export { conversationHasUserMessage };
