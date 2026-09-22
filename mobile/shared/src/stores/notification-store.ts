import { AppState } from 'react-native';
import { create } from 'zustand';
import { api } from '../lib/api';

/**
 * Unread notification count, shared by every screen's bell.
 *
 * Polled rather than pushed: this stack has no websocket or SSE transport, so
 * a poll plus a refresh on foreground and on an arriving push is as close to
 * live as the backend allows today.
 *
 * The polling lives HERE rather than in the bell because Expo Router keeps
 * visited tab screens mounted -- home, schedule, attendance and profile all
 * hold a live bell at once. Per-component intervals meant four timers, four
 * simultaneous requests on every foreground, and no ordering guarantee between
 * their responses.
 */
const POLL_MS = 60_000;

interface NotificationState {
  unread: number;
  /** Single-flight: concurrent callers share one request. */
  refresh: () => Promise<void>;
  /** Ref-counted; the first subscriber starts the timer, the last stops it. */
  subscribe: () => () => void;
}

let inFlight: Promise<void> | null = null;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let appState: { remove: () => void } | null = null;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unread: 0,

  refresh: () => {
    // Sharing the in-flight promise also fixes the ordering hazard: without it
    // a slow earlier response could land after a fast later one and overwrite
    // the newer count.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const list = await api.notifications.list();
        set({ unread: list.filter((n) => !n.read_at).length });
      } catch {
        // A failed poll must never surface as an error on an unrelated screen;
        // the previous count stands until the next one succeeds.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  subscribe: () => {
    subscribers += 1;
    if (subscribers === 1) {
      timer = setInterval(() => void get().refresh(), POLL_MS);
      appState = AppState.addEventListener('change', (next) => {
        if (next === 'active') void get().refresh();
      });
    }
    void get().refresh();

    return () => {
      subscribers -= 1;
      if (subscribers > 0) return;
      if (timer) clearInterval(timer);
      timer = null;
      appState?.remove();
      appState = null;
    };
  },
}));
