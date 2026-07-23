"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { Badge } from "@/components/ui";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  /** When set, the item only shows for these roles. */
  roles?: Role[];
}

// Feature routes are added here as modules land under app/(protected)/.
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/requests", label: "Work requests" },
  { href: "/assignments", label: "Assignments" },
  { href: "/attendance", label: "Attendance" },
  { href: "/hotels", label: "Hotels", roles: ["manager", "admin"] },
  { href: "/hotel-groups", label: "Hotel groups", roles: ["manager", "admin"] },
  { href: "/notifications", label: "Notifications" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="flex h-14 items-center border-b border-gray-200 px-6 font-semibold text-gray-900">
          Hotel CRM
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.filter(
            (item) => !item.roles || (user && item.roles.includes(user.role)),
          ).map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium",
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-100",
                )}
              >
                <span>{item.label}</span>
                {item.href === "/notifications" && unreadCount > 0 && (
                  <Badge tone="info">{unreadCount}</Badge>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
          <span className="text-sm text-gray-500 md:hidden">Hotel CRM</span>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-700">
                  {user.first_name} {user.last_name}
                </span>
                <Badge tone="info">{user.role}</Badge>
              </div>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Log out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
