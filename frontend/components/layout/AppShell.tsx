"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui";
import { SidebarNav } from "@/components/layout/SidebarNav";

const BrandMark = () => (
  <div className="flex h-14 items-center border-b border-gray-200 px-6 font-semibold text-gray-900">
    Hotel CRM
  </div>
);

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // While the drawer is open: lock body scroll, close on Escape, move focus
  // into the drawer, trap Tab within it, and restore focus to the trigger.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const focusable =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileNavOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const panel = drawerRef.current;
      if (!panel) return;
      const items = panel.querySelectorAll<HTMLElement>(focusable);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>(focusable)?.focus();
    // Capture the trigger now so cleanup restores focus to the right element.
    const trigger = menuButtonRef.current;

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      trigger?.focus();
    };
  }, [mobileNavOpen]);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        <BrandMark />
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            className="relative z-10 flex h-full w-64 max-w-[80%] flex-col bg-white shadow-xl"
          >
            <BrandMark />
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 sm:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            className="-ml-1 rounded-md p-2 text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 md:hidden"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-900 md:hidden">
            Hotel CRM
          </span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {user && (
              <Link
                href="/profile"
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
              >
                <span className="hidden text-gray-700 sm:inline">
                  {user.first_name} {user.last_name}
                </span>
                <Badge tone="info">{user.role}</Badge>
              </Link>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
            >
              Log out
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
