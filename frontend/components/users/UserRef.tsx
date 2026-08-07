"use client";

import { useAuth } from "@/hooks/useAuth";
import { useUsersByIds } from "@/hooks/useHotels";
import { TextLink } from "@/components/ui";

/**
 * Renders a reference to a user: their name, linked to their profile only
 * when the viewer can actually open it.
 *
 * Two problems this solves, both hit by workers and checkers (2026-08-07):
 *
 * 1. `/users/:id` is gated to admin/manager/regional_manager, so a worker who
 *    followed one of these links landed on "Only admins and managers can view
 *    user accounts." The link looked live and led nowhere.
 *
 * 2. `GET /users/:id` requires the `users:read` permission, which
 *    ROLE_PERMISSIONS grants only to those same three roles. The name never
 *    resolved for a worker either -- useUsersByIds() swallows the 403 and
 *    falls back, so they saw a bare "View user" placeholder.
 *
 * Showing a name as plain text is the correct outcome for a worker: knowing
 * WHO raised a request is legitimately useful; navigating to their account
 * record is not their business. Callers pass `fallback` for the text to show
 * when the name cannot be resolved.
 */
export function UserRef({
  userId,
  fallback = "—",
}: {
  userId: string | null | undefined;
  fallback?: string;
}) {
  const { user: viewer } = useAuth();
  // Mirrors the route gate on /users/[id] and the users:read permission grant.
  // Kept as an allow-list of the three privileged roles rather than a
  // deny-list of worker/checker, so a future role defaults to the safe branch.
  const canViewUsers =
    viewer?.role === "admin" ||
    viewer?.role === "manager" ||
    viewer?.role === "regional_manager";

  // Skip the fetch entirely when the viewer lacks users:read -- it would 403.
  const byId = useUsersByIds(canViewUsers && userId ? [userId] : []);

  if (!userId) return <span className="text-gray-500">{fallback}</span>;

  const resolved = byId.get(userId);
  const name = resolved ? `${resolved.first_name} ${resolved.last_name}` : null;

  if (!canViewUsers) {
    // No link, and no raw id: a cuid tells a worker nothing. When the name is
    // unavailable the caller's fallback ("the manager", "a colleague") is more
    // informative than the identifier would be.
    return <span>{name ?? fallback}</span>;
  }

  return <TextLink href={`/users/${userId}`}>{name ?? fallback}</TextLink>;
}
