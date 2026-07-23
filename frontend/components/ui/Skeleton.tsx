import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** A single shimmering placeholder block. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-gray-200", className)}
      aria-hidden
      {...props}
    />
  );
}

/**
 * A placeholder table body sized to the given column/row counts, matching the
 * `Table` cell padding so loading and loaded states don't jump.
 */
export function TableSkeleton({
  columns,
  rows = 5,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <tbody className="divide-y divide-gray-100">
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-[8rem]" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
