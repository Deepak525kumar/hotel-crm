import { create } from "zustand";
import type { AuthUser } from "@/lib/types";
// NOT a static top-level import: lib/api.ts already imports this store (for
// apiFetch's 401/TOKEN_REVOKED handling), and stores/locale.ts imports
// authApi from lib/api.ts -- a static import here closes that into a real
// require cycle (api.ts -> auth.ts -> locale.ts -> api.ts), which breaks
// module evaluation under Jest/CJS interop ("Cannot access 'ApiError' before
// initialization" in any test file whose require order hits this path).
// require()'d lazily inside setUser below instead, so this module's own
// top-level evaluation never touches locale.ts at all.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getLocaleStore = () => require("./locale").useLocaleStore;

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

  // Found 2026-09-02 by real E2E probing (scenario 13 language/RTL): the
  // login response was missing preferred_language (fixed separately,
  // backend), but even after that fix the UI stayed in the wrong language
  // and direction after a fresh login until a manual page reload.
  //
  // Root cause was here, not on the backend: LocaleProvider's own
  // reconciliation effect (components/i18n/LocaleProvider.tsx) is gated on
  // the locale store's `reconciled` flag, which the UNAUTHENTICATED
  // login/password-reset screen already flips to `true` (so THOSE public
  // pages can render in a negotiated language too -- see that store's own
  // comment). `router.replace("/dashboard")` after a successful login is
  // client-side navigation, so LocaleProvider never remounts and `reconciled`
  // never resets -- the effect's guard (`if (reconciled ...) return`) then
  // silently skips reconciling against the newly-authenticated user's REAL
  // preference for the rest of the session.
  //
  // setUser is the one call this store makes only with fresh, authoritative
  // server data (login, signup, and /auth/me revalidation) -- never a guess.
  // Reconciling directly here, unconditionally, is therefore always correct
  // and sidesteps the stale-`reconciled`-flag trap entirely, rather than
  // trying to patch the flag's lifecycle to distinguish "never reconciled"
  // from "reconciled against the wrong (unauthenticated) state."
  // reconcileFromServer() is itself idempotent (no-ops when the locale
  // already matches), so calling it on every setUser is safe.
  setUser: (user) => {
    set({ user, status: "authenticated" });
    getLocaleStore().getState().reconcileFromServer(user.preferred_language);
  },

  clear: () => set({ user: null, status: "unauthenticated" }),
}));
