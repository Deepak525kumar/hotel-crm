import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Optional call-to-action (e.g. a "Create" button). */
  action?: ReactNode;
  className?: string;
}

/** Centered placeholder for empty collections and blank slates. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
