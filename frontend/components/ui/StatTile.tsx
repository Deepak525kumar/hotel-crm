import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Secondary line under the value (e.g. a proportion or delta). */
  hint?: ReactNode;
  className?: string;
}

/** A single headline metric in a bordered card. Compose into a grid. */
export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-white p-4 shadow-sm",
        className,
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
