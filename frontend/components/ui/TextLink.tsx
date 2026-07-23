import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type TextLinkProps = ComponentProps<typeof Link>;

/**
 * The app's standard inline text link: blue, underline on hover, and — unlike
 * a bare `<Link>` — a visible keyboard focus ring (WCAG 2.4.7). Extra layout
 * classes (`block`, `text-sm`, …) can still be passed via `className`.
 */
export function TextLink({ className, ...props }: TextLinkProps) {
  return (
    <Link
      className={cn(
        "rounded-sm text-blue-700 hover:underline",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        className,
      )}
      {...props}
    />
  );
}
