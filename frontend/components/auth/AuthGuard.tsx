"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { useMe } from "@/hooks/useAuth";

/**
 * Client-side route guard. Renders a loading state while the persisted
 * session rehydrates, redirects unauthenticated users to `/login`, and
 * otherwise renders the protected tree (while revalidating `/auth/me`).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  // Keep the cached user fresh; a 401 here triggers refresh/logout in apiFetch.
  useMe();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
        />
      </div>
    );
  }

  return <>{children}</>;
}
