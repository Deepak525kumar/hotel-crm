"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { AuthUser } from "@/lib/types";

/**
 * Primary auth hook: exposes the current session plus login/logout
 * actions. Token storage and refresh are handled in the store and
 * `apiFetch`; this hook is the React-facing surface.
 */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  const login = useCallback(
    async (email: string, password: string) => {
      // Security #4: the response still includes access_token/refresh_token
      // (mobile needs them in the body), but the web client never reads or
      // stores them -- the backend's Set-Cookie response is what actually
      // establishes the session. Only `user` is cached client-side.
      const data = await authApi.login(email, password);
      setUser(data.user);
      return data.user;
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    try {
      // Security #4: no refresh token to read/send -- the cookie identifies
      // the session; the backend clears both cookies in its response.
      await authApi.logout();
    } catch {
      // Best-effort: clear locally even if the server call fails.
    } finally {
      clear();
    }
  }, [clear]);

  return {
    user,
    status,
    isAuthenticated: status === "authenticated",
    login,
    logout,
  };
}

/**
 * Fetches and revalidates `/auth/me` via SWR while authenticated,
 * keeping the cached user in the store in sync with the server.
 */
export function useMe() {
  const status = useAuthStore((s) => s.status);
  const setUser = useAuthStore((s) => s.setUser);

  return useSWR<AuthUser>(
    status === "authenticated" ? "/auth/me" : null,
    () => authApi.me(),
    {
      onSuccess: (data) => setUser(data),
      revalidateOnFocus: false,
    },
  );
}
