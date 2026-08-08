"use client";

import { useEffect, useRef } from "react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

/**
 * Security #4 (2026-08-09): resolves the initial `status`/`user` on every
 * page load by calling `GET /auth/me`, which succeeds or fails based on
 * whatever httpOnly cookie the browser already has -- there is no
 * client-readable persisted state to read synchronously anymore (that was
 * the whole point: tokens no longer live in localStorage).
 *
 * Mounted once in the root layout (not inside `(protected)/AuthGuard`)
 * because `app/page.tsx`'s redirect gate also depends on `status`, and
 * that route sits outside the protected group.
 */
export function SessionBootstrap() {
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);
  const ranOnce = useRef(false);

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;

    authApi
      .me()
      .then((user) => setUser(user))
      .catch(() => clear());
  }, [setUser, clear]);

  return null;
}
