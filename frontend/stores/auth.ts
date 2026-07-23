import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AUTH_STORAGE_KEY } from "@/lib/config";
import type { AuthTokens, AuthUser } from "@/lib/types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  /**
   * `loading` until the persisted store has rehydrated, then either
   * `authenticated` or `unauthenticated`.
   */
  status: AuthStatus;

  /** Store a full session (tokens + user) after a successful login. */
  setSession: (payload: AuthTokens & { user: AuthUser }) => void;
  /** Replace just the tokens after a refresh, keeping the current user. */
  setTokens: (tokens: AuthTokens) => void;
  /** Update the cached user (e.g. after fetching `/auth/me`). */
  setUser: (user: AuthUser) => void;
  /** Drop all auth state — used by logout and on unrecoverable 401s. */
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      status: "loading",

      setSession: ({ user, access_token, refresh_token }) =>
        set({
          user,
          accessToken: access_token,
          refreshToken: refresh_token,
          status: "authenticated",
        }),

      setTokens: ({ access_token, refresh_token }) =>
        set({ accessToken: access_token, refreshToken: refresh_token }),

      setUser: (user) => set({ user, status: "authenticated" }),

      clear: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          status: "unauthenticated",
        }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      // Only persist the fields needed to restore a session.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      // Resolve the loading state once rehydration finishes.
      //
      // With synchronous storage (localStorage) Zustand runs this callback
      // *synchronously* inside the `create()` call above, before the
      // `useAuthStore` const is initialized. Referencing it directly would
      // throw a ReferenceError (swallowed by the persist middleware), leaving
      // `status` stuck on "loading". Defer the update to a microtask so the
      // binding exists and the change notifies subscribers.
      onRehydrateStorage: () => (state) => {
        queueMicrotask(() => {
          useAuthStore.setState({
            status: state?.accessToken ? "authenticated" : "unauthenticated",
          });
        });
      },
    },
  ),
);
