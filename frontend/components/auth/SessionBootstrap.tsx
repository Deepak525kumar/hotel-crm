"use client";

import { useEffect, useRef } from "react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

// If the backend is unreachable, `authApi.me()` could otherwise hang for as
// long as the browser's own connection timeout allows, leaving `status`
// stuck at "loading" and every route gate that depends on it (AuthGuard,
// app/page.tsx's redirect) blocked indefinitely with no feedback. Racing
// against a local timeout bounds that: past 8s we give up waiting and treat
// the session the same as a failed `/auth/me` call (unauthenticated), rather
// than leave the app spinning forever on a slow or dead backend.
const BOOTSTRAP_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Session bootstrap timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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

    withTimeout(authApi.me(), BOOTSTRAP_TIMEOUT_MS)
      .then((user) => setUser(user))
      .catch(() => clear());
  }, [setUser, clear]);

  return null;
}
