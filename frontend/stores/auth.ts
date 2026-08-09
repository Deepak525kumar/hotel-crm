import { create } from "zustand";
import type { AuthUser } from "@/lib/types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  user: AuthUser | null;
  /**
   * `loading` until the boot-time session check resolves, then either
   * `authenticated` or `unauthenticated`.
   *
   * Security #4 (2026-08-09): tokens are no longer stored here (or
   * anywhere else client-readable) -- they live only in httpOnly cookies
   * set by the backend (lib/api.ts sends `credentials: 'include'`; the
   * browser attaches them automatically). This store persists nothing:
   * `SessionBootstrap` (components/auth/SessionBootstrap.tsx) resolves
   * `user`/`status` on every load via `GET /auth/me`, which succeeds or
   * fails based on whatever cookie the browser already has.
   */
  status: AuthStatus;

  /** Cache the user after a successful login/signup/session-bootstrap. */
  setUser: (user: AuthUser) => void;
  /** Drop cached auth state — used by logout, session-bootstrap failure,
   * and on unrecoverable 401s. Does NOT touch cookies itself; the caller
   * (authApi.logout, or apiFetch's TOKEN_REVOKED handling) is responsible
   * for that server round-trip. */
  clear: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  status: "loading",

  setUser: (user) => set({ user, status: "authenticated" }),

  clear: () => set({ user: null, status: "unauthenticated" }),
}));
