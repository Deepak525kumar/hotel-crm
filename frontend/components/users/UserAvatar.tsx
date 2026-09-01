import { useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { cn } from "@/lib/cn";

export interface UserAvatarProps {
  userId: string;
  name: string;
  hasPhoto: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps["size"]>, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-20 w-20 text-xl",
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/**
 * `GET /users/:id/photo` (users/routes.ts) is a stable, user-id-keyed URL —
 * never a presigned one — reached same-origin through the Next.js rewrite
 * proxy, so the browser attaches the auth cookie automatically and, per the
 * backend's `Cache-Control: private, max-age=86400`, caches the response by
 * this exact URL instead of re-fetching it on every profile view.
 *
 * `hasPhoto` gates the request entirely: skipping it for an account with no
 * photo avoids a guaranteed 404 render flash on every worker/checker list.
 */
export function UserAvatar({ userId, name, hasPhoto, size = "md", className }: UserAvatarProps) {
  const [errored, setErrored] = useState(false);
  const showPhoto = hasPhoto && !errored;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- an authenticated, same-origin proxy URL (cookie sent automatically); next/image's remote-loader allowlist buys nothing here.
        <img
          src={`${API_BASE_URL}/users/${userId}/photo`}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span aria-hidden="true">{initials(name) || "?"}</span>
      )}
    </div>
  );
}
