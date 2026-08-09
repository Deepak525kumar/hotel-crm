import { cn } from "@/lib/cn";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const BAR_TONE: Record<Tone, string> = {
  neutral: "bg-gray-400",
  info: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-gray-400",
  info: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

export interface BreakdownSegment {
  label: string;
  value: number;
  tone?: Tone;
}

/**
 * A stacked proportion bar plus a legend of counts. Segments with a zero value
 * are dropped from the bar but still listed, so the legend stays stable.
 */
export function BreakdownBar({ segments }: { segments: BreakdownSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="space-y-3">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${s.value}`)
          .join(", ")}
      >
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.label}
                className={cn(BAR_TONE[s.tone ?? "neutral"])}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {segments.map((s) => (
          <li
            key={s.label}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
          >
            <span
              aria-hidden
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                DOT_TONE[s.tone ?? "neutral"],
              )}
            />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
