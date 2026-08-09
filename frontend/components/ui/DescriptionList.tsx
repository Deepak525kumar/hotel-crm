import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A labelled key/value row for detail views. */
export function DataRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4 py-2.5 text-sm",
        className,
      )}
    >
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

/** A divided stack of {@link DataRow}s. */
export function DataList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-gray-100 dark:divide-gray-800", className)}>{children}</div>
  );
}
