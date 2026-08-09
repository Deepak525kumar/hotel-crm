"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";

/**
 * Entry route. Auth state lives client-side, so we wait for the store to
 * rehydrate and then route to the dashboard or login accordingly.
 */
export default function Home() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
    else if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <span
        role="status"
        aria-label="Loading"
        className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
      />
    </div>
  );
}
