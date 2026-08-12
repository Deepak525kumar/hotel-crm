"use client";

import { APP_OWNER } from "@/lib/config";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { cn } from "@/lib/cn";

/**
 * `collapsed` swaps the full wordmark for just the initial, matching the
 * icon-only rail. Padding/alignment is conditional the same way
 * SidebarNav's links are, so the "H" centers in the same 64px column the
 * nav icons center in below it, rather than sitting at a fixed `px-6`
 * inset that only lines up once expanded.
 */
const BrandMark = ({ collapsed = false }: { collapsed?: boolean }) => (
  <div
    // px-4 in both states (rather than px-0 <-> px-6) so the "H" sits at
    // the same x as the nav icons below it and nothing has to slide.
    className="flex h-14 shrink-0 items-center overflow-hidden border-b border-gray-200 px-4 font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100"
  >
    {/* The wordmark previously swapped its text content outright ("H" <->
        "Hotel CRM") the instant `collapsed` flipped, so it popped a frame
        ahead of the rail's easing width. Rendering the "H" permanently and
        animating only the remainder ("otel CRM") means the glyph never
        moves or re-renders -- the tail just grows out of it, on the same
        0fr/1fr grid + 200ms ease-out every other label in the rail uses. */}
    <span aria-hidden>F</span>
    <span
      className={cn(
        "grid transition-[grid-template-columns,opacity] duration-200 ease-out",
        collapsed ? "grid-cols-[0fr] opacity-0" : "grid-cols-[1fr] opacity-100",
      )}
    >
      <span className="overflow-hidden whitespace-nowrap">HM Hotelservice</span>
    </span>
    <span className="sr-only">FHM Hotelservice</span>
  </div>
);

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Two independent booleans, not one shared flag: mouse hover and keyboard
  // focus have different lifetimes and must not cancel each other. A single
  // shared flag caused two real bugs -- tabbing into a link (focus expands
  // the rail) then moving the mouse out of it collapsed the rail via
  // onMouseLeave while that link still held focus (its label vanishing out
  // from under an active focus ring); and tabbing out while the pointer
  // happened to be resting on the rail left it stuck expanded/collapsed
  // until the next real pointer crossing, since mouseenter/mouseleave don't
  // re-fire on their own. OR-ing two independent booleans for the expanded
  // state fixes both: each input source's own enter/leave event only ever
  // touches its own boolean.
  const [sidebarMouseHovered, setSidebarMouseHovered] = useState(false);
  const [sidebarFocusWithin, setSidebarFocusWithin] = useState(false);
  const sidebarExpanded = sidebarMouseHovered || sidebarFocusWithin;
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
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Desktop sidebar — an icon-only rail by default, expanding smoothly
          to show labels on hover OR keyboard focus (independently tracked,
          see the state comment above). `w-16`/`w-60` bracket the transition;
          `overflow-hidden` on children clips labels mid-expand so they don't
          bleed into the main content area before the width animates open. */}
      <aside
        onMouseEnter={() => setSidebarMouseHovered(true)}
        onMouseLeave={() => setSidebarMouseHovered(false)}
        onFocus={() => setSidebarFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setSidebarFocusWithin(false);
          }
        }}
        className={cn(
          // ease-out (not the default ease) and a shared 200ms duration
          // across every animated property in the rail -- the width here,
          // the link padding, and the label grid in SidebarNav. Previously
          // these used different property sets and no explicit curve, so
          // they visibly finished at different moments.
          "sticky top-0 hidden h-screen min-h-0 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white transition-[width] duration-200 ease-out dark:border-gray-800 dark:bg-gray-900 md:flex",
          sidebarExpanded ? "w-60" : "w-16",
        )}
      >
        <BrandMark collapsed={!sidebarExpanded} />
        <SidebarNav collapsed={!sidebarExpanded} />
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
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            className="relative z-10 flex h-full w-64 max-w-[80%] flex-col bg-white shadow-xl dark:bg-gray-900"
          >
            <BrandMark />
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900 sm:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            className="-ml-1 rounded-md p-2 text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:bg-gray-800 md:hidden"
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
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 md:hidden">
            FHM Hotelservice
          </span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {user && <NotificationsBell />}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Log out
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>

        {/* Ownership notice. Sits after the `flex-1` <main> in the same flex
            column, so on short pages it rests at the bottom of the viewport
            and on long ones it simply follows the content -- no sticky
            positioning, and nothing overlapping the page itself. The year is
            computed per render rather than hardcoded so it never goes stale. */}
        <footer className="px-4 pb-4 text-center text-xs text-gray-400 dark:text-gray-500 sm:px-6">
          <div className="mb-2 space-y-1">
            <p className="font-semibold text-gray-900 dark:text-gray-100">FHM Hotelservice GmbH</p>
            <p>Berner Straße 38, 60437 Frankfurt am Main</p>
            <p>Tel.: 0160 97044182 | Email: info@fhm-hotelservice.de</p>
          </div>
          &copy; {new Date().getFullYear()} FHM Hotelservice GmbH. All rights reserved.
          <br />
          This application is owned by FHM Hotelservice GmbH and developed by {APP_OWNER}.
        </footer>
      </div>
    </div>
  );
}
