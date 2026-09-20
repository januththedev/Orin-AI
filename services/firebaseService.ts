
import { getAnalytics } from "firebase/analytics";
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import { getFirestore, doc, setDoc, getDoc, updateDoc, Firestore, serverTimestamp, collection, query, orderBy, getDocs, where, addDoc, deleteDoc, limit, startAfter, DocumentSnapshot, arrayUnion, arrayRemove, increment } from "firebase/firestore";
import { Conversation, UserAccount, UserRole, SignupRequest, SiteMetrics, ApiKeyDef, conversationHasUserMessage } from "../types";

interface UsagePlanLimits {
  textPerDay: number | null;
  imagesPer30Days: number | null;
  videosPer30Days: number | null;
}

// Configuration — every field overridable via env (see .env.example);
// hardcoded values are the orin-ai-f6798 project fallback.
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyB5rY4e-_GOkkl4qwDZuvHqwq0_IP9mFmA",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "orin-ai-f6798.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "orin-ai-f6798",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "orin-ai-f6798.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "259788442094",
  appId: process.env.FIREBASE_APP_ID || "1:259788442094:web:4d946378ca1b4d7349a6ff",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-57DHESH4ZJ"
};

declare global {
  interface Window {
    handleNativeGoogleToken?: (token: string) => Promise<void>;
  }
}

class FirebaseService {
  private app: any;
  private analytics: any = null;
  private auth: firebase.auth.Auth | null = null;
  private db: Firestore | null = null;

  constructor() {
    try {
      if (!firebase.apps.length) {
        this.app = firebase.initializeApp(firebaseConfig);
      } else {
        this.app = firebase.app();
      }
      
      if (typeof window !== 'undefined') {
        this.auth = firebase.auth();
        this.db = getFirestore(this.app);
        
        if (this.auth) {
          // iOS Safari: indexedDB (LOCAL) is cleared by ITP between sessions.
          // Use SESSION on mobile so at least the active session works reliably.
          const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
          const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
          const persistence = isMobile
            ? firebase.auth.Auth.Persistence.SESSION
            : firebase.auth.Auth.Persistence.LOCAL;
          this.auth.setPersistence(persistence).catch(() => {
            // Final fallback — no persistence (still works for single session)
            this.auth!.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(() => {});
          });
        }

        try {
          this.analytics = getAnalytics(this.app);
        } catch (_) {}
      }
    } catch (_) {}
  }

  async getRedirectResult(): Promise<{ credential: firebase.auth.UserCredential | null; error: string | null }> {
    if (!this.auth) return { credential: null, error: null };
    try {
      // Hard 6s timeout — Firebase compat getRedirectResult hangs indefinitely on
      // iOS Safari when no redirect was pending (the most common case on page load).
      const timeoutP = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('no_redirect')), 6000)
      );
      const credential = await Promise.race([this.auth.getRedirectResult(), timeoutP]);
      return { credential, error: null };
    } catch (err: any) {
      if (err?.message === 'no_redirect') return { credential: null, error: null }; // silent — normal load
      const msg = err?.message || err?.code || 'Unknown error';
      return { credential: null, error: msg };
    }
  }

  async logout(): Promise<void> {
    if (this.auth) await this.auth.signOut();
  }

  // ─── Orin AI password accounts ─────────────────────────────────────────────

  /** POST /api/auth/password with the caller's Bearer token (for set-password). */
  private async authApi(action: string, body: Record<string, unknown>): Promise<any> {
    const token = await this.getIdToken();
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

  /** Sign in with email-or-phone + password. Returns the Firebase user after custom-token exchange. */
  async loginWithPassword(identifier: string, password: string): Promise<firebase.User | null> {
    if (!this.auth) throw new Error("Authentication module not initialized.");
    const data = await this.authApi('login', { identifier, password });
    const cred = await this.auth.signInWithCustomToken(data.customToken);
    return cred.user ?? null;
  }

  /**
   * Register with name + email + phone + password (both identifiers become login IDs).
   * Returns the signed-in Firebase user.
   */
  async registerWithPassword(name: string, email: string, phone: string, password: string): Promise<firebase.User | null> {
    if (!this.auth) throw new Error("Authentication module not initialized.");
    const data = await this.authApi('register', { name, email, phone, password });
    const cred = await this.auth.signInWithCustomToken(data.customToken);
    return cred.user ?? null;
  }

  /**
   * Password reset step 1 — verify identity with name + email + phone.
   * Resolves a short-lived single-use reset token (kept in memory only).
   */
  async requestPasswordReset(name: string, email: string, phone: string): Promise<string> {
    const data = await this.authApi('reset-verify', { name, email, phone });
    return data.resetToken;
  }

  /** Password reset step 2 — consume the token and set the new password. */
  async confirmPasswordReset(resetToken: string, password: string): Promise<void> {
    await this.authApi('reset-confirm', { resetToken, password });
  }

  /** Set or change the Orin AI password on the CURRENTLY signed-in account (Google users included). */
  async setPassword(password: string): Promise<void> {
    await this.authApi('set-password', { password });
  }

  /**
   * Sign in from a backend-minted custom token — used by the desktop device-flow
   * (browser approval) so the Electron window picks up the approved session.
   */
  async signInWithCustom(customToken: string): Promise<firebase.User | null> {
    if (!this.auth) throw new Error("Authentication module not initialized.");
    const cred = await this.auth.signInWithCustomToken(customToken);
    return cred.user ?? null;
  }


  /** Update display name / phone on the user's own profile doc. */
  async updateUserProfile(uid: string, data: { name?: string; phone?: string }): Promise<void> {
    const ref = this.userRef(uid);
    if (!ref) throw new Error('DB not initialized');
    await updateDoc(ref, { ...data, lastUpdated: serverTimestamp() });
  }



  async getIdToken(): Promise<string> {
    try { return await this.auth?.currentUser?.getIdToken() ?? ''; }
    catch { return ''; }
  }

  currentUser(): firebase.User | null {
    return this.auth?.currentUser ?? null;
  }

  onAuthStateChanged(callback: (user: firebase.User | null) => void) {
    if (this.auth) return this.auth.onAuthStateChanged(callback);
    callback(null);
    return () => {};
  }

  /** POST /api/admin — role-checked admin operations (replaced Firebase Cloud Functions). */
  private async adminApi(action: string, body: Record<string, unknown>): Promise<any> {
    const token = await this.getIdToken();
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
    if (!this.db) return [];
    const q = query(collection(this.db, "pending_signups"), where("status", "==", "pending"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SignupRequest));
  }

  async getApiKeys(): Promise<ApiKeyDef[]> {
    if (!this.db) return [];
    const q = query(collection(this.db, "api_keys"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ApiKeyDef));
  }

  async getSiteMetrics(): Promise<SiteMetrics> {
    if (!this.db) return { totalUsers: 0, activeToday: 0, aiRequests: 0, serverStatus: 'online', lastBackup: new Date() };
    const snap = await getDoc(doc(this.db, "site_metrics", "meters"));
    if (snap.exists()) {
      const data = snap.data();
      return {
        totalUsers: data.totalUsers || 0,
        activeToday: data.activeToday || 0,
        aiRequests: data.aiRequests || 0,
        serverStatus: data.serverStatus || 'online',
        lastBackup: data.lastBackup?.toDate() || new Date()
      };
    }
    return { totalUsers: 1, activeToday: 1, aiRequests: 50, serverStatus: 'online', lastBackup: new Date() };
  }

  private userRef(uid: string) {
    return this.db ? doc(this.db, "users", uid) : null;
  }

  private static readonly DAY_MS = 24 * 60 * 60 * 1000;
  private static readonly THIRTY_DAYS_MS = 30 * FirebaseService.DAY_MS;

  async syncUserSession(uid: string, email: string, photoURL?: string | null): Promise<UserAccount> {
    // Log this login to Firestore immediately — before any chat starts
    if (this.db) {
      try {
        const today = new Date().toISOString().split('T')[0];
        await setDoc(doc(this.db, 'login_events', `${uid}_${today}`), {
          uid, email: email || null, loginAt: serverTimestamp(), date: today
        }, { merge: true });
      } catch { /* non-blocking */ }
    }
    if (!this.db) throw new Error("DB not init");
    const userRef = doc(this.db, "users", uid);
    const snap = await getDoc(userRef);
    let userData: any;

    if (!snap.exists()) {
      // New users start as visitors
      userData = {
        ...(email ? { email } : {}),
        name: email ? email.split('@')[0] : 'Orin User',
        avatar: photoURL || null,
        plan: 'free',
        role: 'visitor',
        approved: false,
        subscriptionStatus: 'active',
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
        usage: { text: 0, images: 0, videos: 0, mediaWindowStart: Date.now() },
        memory: "User is new to Orin AI.",
        lastReset: Date.now()
      };
      await setDoc(userRef, userData);
    } else {
      userData = snap.data();
      const updates: any = {};
      if (photoURL && userData.avatar !== photoURL) updates.avatar = photoURL;

      const now = Date.now();
      const usage = userData.usage ?? { text: 0, images: 0, videos: 0 };
      let lastReset: number = userData.lastReset || 0;
      let mediaWindowStart: number = usage.mediaWindowStart || lastReset || now;
      let changed = false;

      // Reset daily text usage if a full day has passed
      if (!lastReset || now - lastReset > FirebaseService.DAY_MS) {
        usage.text = 0;
        lastReset = now;
        changed = true;
      }

      // Reset 30-day window for images/videos if needed
      if (!mediaWindowStart || now - mediaWindowStart > FirebaseService.THIRTY_DAYS_MS) {
        usage.images = 0;
        usage.videos = 0;
        mediaWindowStart = now;
        changed = true;
      }

      if (changed) {
        usage.mediaWindowStart = mediaWindowStart;
        updates.usage = usage;
        updates.lastReset = lastReset;
        userData.usage = usage;
      }

      if (Object.keys(updates).length > 0) await updateDoc(userRef, updates);
    }

    const plan = (userData.plan || 'free').toLowerCase();
    const tier = (plan === 'pro' || plan === 'pro_yearly' || plan === 'elite')
      ? 'Pro (BYO-Google)'
      : (plan === 'basic' || plan === 'basic_yearly')
        ? 'Basic'
        : 'Free';
    return {
      id: uid,
      name: userData.name || (email ? email.split('@')[0] : 'Orin User'),
      email: userData.email || email || '',
      phone: userData.phone || undefined,
      avatar: userData.avatar,
      tier,
      plan: userData.plan || 'free',
      role: userData.role || 'visitor',
      approved: userData.approved || false,
      dailyUsage: userData.usage || { text: 0, images: 0, videos: 0 },
    };
  }

  // Orin AI is completely free — no usage caps client-side (`null` = unlimited
  // in checkLimit); the API layer keeps its own abuse protection.
  private static readonly USAGE_LIMITS: Record<string, UsagePlanLimits> = {
    free:         { textPerDay: null, imagesPer30Days: null, videosPer30Days: null },
    starter:      { textPerDay: null, imagesPer30Days: null, videosPer30Days: null },
    basic:        { textPerDay: null, imagesPer30Days: null, videosPer30Days: null },
    basic_yearly: { textPerDay: null, imagesPer30Days: null, videosPer30Days: null },
    pro:          { textPerDay: null, imagesPer30Days: null, videosPer30Days: null },
    pro_yearly:   { textPerDay: null, imagesPer30Days: null, videosPer30Days: null },
  };

  async checkLimit(uid: string, type: 'text' | 'images' | 'videos'): Promise<boolean> {
    const ref = this.userRef(uid);
    if (!ref) return false;
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return false;
      const data = snap.data();
      const now = Date.now();
      const planKey: string = (data.plan || 'free') === 'elite' ? 'pro' : (data.plan || 'free');
      const limits = FirebaseService.USAGE_LIMITS[planKey] || FirebaseService.USAGE_LIMITS['free'];
      const usage = data.usage ?? { text: 0, images: 0, videos: 0 };
      const lastReset: number = data.lastReset || 0;
      const mediaWindowStart: number = usage.mediaWindowStart || lastReset || now;

      if (type === 'text') {
        const limit = limits.textPerDay;
        if (limit == null) return false;
        const effectiveText = (!lastReset || now - lastReset > FirebaseService.DAY_MS) ? 0 : (usage.text ?? 0);
        return effectiveText >= limit;
      }

      const isImage = type === 'images';
      const limit = isImage ? limits.imagesPer30Days : limits.videosPer30Days;
      if (limit == null) return false;

      const windowFresh = !!mediaWindowStart && now - mediaWindowStart <= FirebaseService.THIRTY_DAYS_MS;
      const rawUsage = isImage ? (usage.images ?? 0) : (usage.videos ?? 0);
      const effectiveUsage = windowFresh ? rawUsage : 0;
      return effectiveUsage >= limit;
    } catch {
      return false; // permission/network; allow request
    }
  }

  async incrementUsage(uid: string, type: 'text' | 'images' | 'videos') {
    const ref = this.userRef(uid);
    if (!ref) return;
    try {
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};
      const now = Date.now();

      const usage = (data.usage ?? { text: 0, images: 0, videos: 0 }) as any;
      let lastReset: number = data.lastReset || 0;
      let mediaWindowStart: number = usage.mediaWindowStart || lastReset || now;

      // Reset daily text if needed
      if (!lastReset || now - lastReset > FirebaseService.DAY_MS) {
        usage.text = 0;
        lastReset = now;
      }

      // Reset 30-day window for media if needed
      if (!mediaWindowStart || now - mediaWindowStart > FirebaseService.THIRTY_DAYS_MS) {
        usage.images = 0;
        usage.videos = 0;
        mediaWindowStart = now;
      }

      if (type === 'text') {
        usage.text = (usage.text ?? 0) + 1;
      } else if (type === 'images') {
        usage.images = (usage.images ?? 0) + 1;
      } else {
        usage.videos = (usage.videos ?? 0) + 1;
      }

      usage.mediaWindowStart = mediaWindowStart;

      await setDoc(ref, { usage, lastReset, lastUpdated: serverTimestamp() }, { merge: true });
    } catch {
      // Permission or network; don't block chat
    }
  }

  async saveFCMToken(uid: string, token: string): Promise<void> {
    const ref = this.userRef(uid);
    if (!ref) return;
    try {
      await updateDoc(ref, {
        fcmToken: token,
        fcmTokenUpdatedAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      });
    } catch (_) {}
  }

  async updatePlan(uid: string, plan: string) {
    const ref = this.userRef(uid);
    if (!ref) return;
    await updateDoc(ref, { plan: plan.toLowerCase(), lastUpdated: serverTimestamp() });
  }

  async getUsage(uid: string): Promise<{ text: number; images: number; videos: number }> {
    const ref = this.userRef(uid);
    if (!ref) return { text: 0, images: 0, videos: 0 };
    const snap = await getDoc(ref);
    if (!snap.exists()) return { text: 0, images: 0, videos: 0 };
    const u = snap.data().usage ?? {};
    return { text: u.text ?? 0, images: u.images ?? 0, videos: u.videos ?? 0 };
  }

  async getUserMemory(uid: string): Promise<string> {
    const ref = this.userRef(uid);
    if (!ref) return "";
    try {
      const snap = await getDoc(ref);
      return snap.exists() ? (snap.data().memory ?? "") : "";
    } catch {
      return ""; // permission/network; continue without memory
    }
  }

  async updateUserMemory(uid: string, memory: string) {
    const ref = this.userRef(uid);
    if (!ref) return;
    await updateDoc(ref, { memory });
  }

  async saveHistory(uid: string, history: Conversation[], deletedIds: string[] = []) {
    const ref = this.userRef(uid);
    if (!ref) return;
    try {
      let cloud: Conversation[] | null = null;
      try {
        cloud = await this.getHistory(uid);
      } catch {
        // Use empty cloud so we still persist local history (e.g. offline or permission)
      }
      const cloudList = (cloud || []).filter(c => conversationHasUserMessage(c));
      const localList = history.filter(c => conversationHasUserMessage(c));
      const localById = new Map(localList.map(c => [c.id, c]));
      // Merge: for each cloud conv, keep cloud unless local has more messages or newer timestamp
      for (const c of cloudList) {
        const existing = localById.get(c.id);
        if (!existing) {
          localById.set(c.id, c);
          continue;
        }
        const cMsg = (c.messages || []).length;
        const eMsg = (existing.messages || []).length;
        const cTime = new Date(c.timestamp).getTime();
        const eTime = new Date(existing.timestamp).getTime();
        if (cMsg > eMsg || (cMsg === eMsg && cTime > eTime)) localById.set(c.id, c);
      }
      const deletedSet = new Set(deletedIds);
      const merged = [...localById.values()]
        .filter(c => !deletedSet.has(c.id))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      await setDoc(ref, { historyBlob: JSON.stringify(merged), lastUpdated: serverTimestamp() }, { merge: true });
    } catch {
      // Network or permission; sync will retry on next change
    }
  }

  async getHistory(uid: string): Promise<Conversation[] | null> {
    const ref = this.userRef(uid);
    if (!ref) return null;
    try {
      const snap = await getDoc(ref);
      const blob = snap.data()?.historyBlob;
      if (blob === undefined || blob === null) return null;
      if (typeof blob !== 'string') return null;
      const parsed = JSON.parse(blob) as any[];
      if (!Array.isArray(parsed)) return null;
      return parsed.map((c: any) => ({
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

  // ─── Creations ─────────────────────────────────────────────────────────────

  async createCreation(data: {
    title: string; caption: string; originalPrompt: string;
    output?: string; mediaUrl?: string;
    mediaType?: 'image' | 'video' | 'music' | 'text';
    tags?: string[]; userId: string; userName: string; userAvatar?: string;
  }): Promise<string> {
    if (!this.db) throw new Error('DB not initialized');
    if (!data.originalPrompt && !data.caption) throw new Error('prompt or caption required');
    const ref = await addDoc(collection(this.db, 'creations'), {
      ...data, likes: [], likeCount: 0, commentCount: 0,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    return ref.id;
  }

  async getCreations(pageSize = 12, lastVisible?: DocumentSnapshot): Promise<{ posts: any[]; lastDoc: DocumentSnapshot | null }> {
    if (!this.db) return { posts: [], lastDoc: null };
    const constraints: any[] = [orderBy('createdAt', 'desc'), limit(pageSize)];
    if (lastVisible) constraints.push(startAfter(lastVisible));
    const snap = await getDocs(query(collection(this.db, 'creations'), ...constraints));
    return {
      posts: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    };
  }

  async getCreation(id: string): Promise<any | null> {
    if (!this.db) return null;
    const snap = await getDoc(doc(this.db, 'creations', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async updateCreation(id: string, data: Partial<{ title: string; caption: string; originalPrompt: string; tags: string[] }>): Promise<void> {
    if (!this.db) return;
    await updateDoc(doc(this.db, 'creations', id), { ...data, updatedAt: serverTimestamp() });
  }

  async deleteCreation(id: string): Promise<void> {
    if (!this.db) return;
    await deleteDoc(doc(this.db, 'creations', id));
  }

  async toggleCreationLike(creationId: string, userId: string): Promise<boolean> {
    if (!this.db) return false;
    const ref = doc(this.db, 'creations', creationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    const liked = (snap.data().likes as string[]).includes(userId);
    await updateDoc(ref, {
      likes: liked ? arrayRemove(userId) : arrayUnion(userId),
      likeCount: increment(liked ? -1 : 1),
    });
    return !liked;
  }

  async addCreationComment(creationId: string, comment: { userId: string; userName: string; userAvatar?: string; text: string }): Promise<any> {
    if (!this.db) throw new Error('DB not initialized');
    if (!comment.text.trim()) throw new Error('Comment cannot be empty');
    const cRef = await addDoc(collection(this.db, 'creations', creationId, 'comments'), {
      ...comment, likes: [], createdAt: serverTimestamp(),
    });
    await updateDoc(doc(this.db, 'creations', creationId), { commentCount: increment(1) });
    return { id: cRef.id, ...comment, likes: [], createdAt: new Date() };
  }

  async getCreationComments(creationId: string): Promise<any[]> {
    if (!this.db) return [];
    const snap = await getDocs(query(collection(this.db, 'creations', creationId, 'comments'), orderBy('createdAt', 'asc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async toggleCommentLike(creationId: string, commentId: string, userId: string): Promise<void> {
    if (!this.db) return;
    const ref = doc(this.db, 'creations', creationId, 'comments', commentId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const liked = (snap.data().likes as string[]).includes(userId);
    await updateDoc(ref, { likes: liked ? arrayRemove(userId) : arrayUnion(userId) });
  }


}

export const firebaseService = new FirebaseService();
