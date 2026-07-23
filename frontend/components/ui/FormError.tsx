import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface FormErrorProps {
  /** The error message. When falsy, nothing renders. */
  children?: ReactNode;
  className?: string;
}

/**
 * Inline form/action error message. Renders nothing when empty, so it can be
 * dropped in place of `{error && <p>…</p>}`. Carries `role="alert"` +
 * `aria-live` so screen readers announce the error the moment it appears.
 */
export function FormError({ children, className }: FormErrorProps) {
  if (!children) return null;
  return (
    <p
      role="alert"
      aria-live="assertive"
      className={cn("text-sm text-red-600", className)}
    >
      {children}
    </p>
  );
}
