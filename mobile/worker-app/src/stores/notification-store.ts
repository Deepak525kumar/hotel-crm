import { create } from 'zustand';
import { api } from '@/lib/api';

/**
 * Unread notification count, shared by every screen's bell.
 *
 * Polled rather than pushed: this stack has no websocket or SSE transport, so
 * a poll plus a refresh on foreground and on an arriving push is as close to
 * live as the backend allows today.
 */
interface NotificationState {
  unread: number;
  refresh: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  refresh: async () => {
    try {
      const list = await api.notifications.list();
      set({ unread: list.filter((n) => !n.read_at).length });
    } catch {
      // A failed poll must never surface as an error on an unrelated screen;
      // the previous count stands until the next one succeeds.
    }
  },
}));
