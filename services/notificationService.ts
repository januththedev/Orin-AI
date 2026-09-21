/**
 * notificationService — push notifications are DISABLED.
 *
 * Push used to run on Firebase Cloud Messaging, which is gone with the
 * Neon migration (no Firebase SDK, no service worker token flow). This stub
 * keeps the call sites (App.tsx) compiling while push stays off. If push is
 * ever wanted again, implement it against a non-Firebase provider (e.g. Web
 * Push with our own VAPID keys + a Neon-backed subscription table).
 */

export type ForegroundMessageHandler = (payload: any) => void;

class NotificationService {
  /** Push is not supported (FCM removed with Firebase). */
  isSupported(): boolean {
    return false;
  }

  get permission(): NotificationPermission | "unsupported" {
    if (typeof window !== "undefined" && "Notification" in window) return Notification.permission;
    return "unsupported";
  }

  async requestPermissionAndToken(_save = true): Promise<string | null> {
    return null;
  }

  async getTokenAndSave(_save = true): Promise<string | null> {
    return null;
  }

  async setupForUser(): Promise<string | null> {
    return null;
  }

  onForegroundMessage(_handler: ForegroundMessageHandler): () => void {
    return () => {};
  }
}

export const notificationService = new NotificationService();
