/**
 * Server-rendered inline SVG bar charts.
 *
 * Rendered as markup rather than drawn by a charting library because the pages
 * run under `script-src 'self'` with no inline script — a CDN chart library
 * would be blocked outright, and silently. Inline SVG needs no JavaScript at
 * all, so the chart survives with scripting disabled and prints correctly.
 *
 * Each bar carries a <title>, which browsers show as a native tooltip and
 * screen readers announce, giving per-mark hover without a line of JS.
 */

export interface DayCount {
  /** YYYY-MM-DD */
  day: string;
  count: number;
}

export interface BarChartOptions {
  data: DayCount[];
  /** Accessible summary; the surrounding panel carries the visible heading. */
  label: string;
  width?: number;
  height?: number;
  /** Single series, so one hue carries no identity load. Validated against the dark surface. */
  color?: string;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "2026-08-30" -> "30 Aug", for the sparse axis labels. */
function shortDate(day: string): string {
  const [, month, date] = day.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(date)} ${months[Number(month) - 1] ?? ""}`.trim();
}

/**
 * A bar per day. Bars are thin, separated by a 2px surface gap, anchored to the
 * baseline with only their top corners rounded — a bar rounded at the bottom
 * would read as floating above the axis.
 */
export function barChart({
  data,
  label,
  width = 280,
  height = 56,
  color = "#3b82f6",
}: BarChartOptions): string {
  if (data.length === 0) {
    return `<svg class="chart" width="${width}" height="${height}" role="img" aria-label="${escapeAttr(label)}: no data"></svg>`;
  }

  const GAP = 2;
  const RADIUS = 2;
  const AXIS = 1;
  const plotHeight = height - AXIS;

  const slot = width / data.length;
  const barWidth = Math.max(1, slot - GAP);

  // A flat all-zero month must not render full-height bars.
  const max = Math.max(...data.map((d) => d.count), 1);

  const bars = data
    .map((d, i) => {
      const x = i * slot + GAP / 2;
      const title = `<title>${escapeAttr(shortDate(d.day))}: ${d.count}</title>`;

      if (d.count === 0) {
        // A 2px stub keeps the day visible as an empty slot rather than a hole,
        // so gaps in the series read as "nothing happened", not "no data".
        return `<rect x="${x.toFixed(2)}" y="${(plotHeight - 2).toFixed(2)}" width="${barWidth.toFixed(2)}" height="2" rx="1" class="chart-zero">${title}</rect>`;
      }

      const barHeight = Math.max(3, (d.count / max) * (plotHeight - 4));
      const y = plotHeight - barHeight;
      const r = Math.min(RADIUS, barWidth / 2, barHeight);
      const w = barWidth;

      // Top corners rounded, bottom square against the baseline.
      const path = [
        `M${x.toFixed(2)},${(y + barHeight).toFixed(2)}`,
        `L${x.toFixed(2)},${(y + r).toFixed(2)}`,
        `Q${x.toFixed(2)},${y.toFixed(2)} ${(x + r).toFixed(2)},${y.toFixed(2)}`,
        `L${(x + w - r).toFixed(2)},${y.toFixed(2)}`,
        `Q${(x + w).toFixed(2)},${y.toFixed(2)} ${(x + w).toFixed(2)},${(y + r).toFixed(2)}`,
        `L${(x + w).toFixed(2)},${(y + barHeight).toFixed(2)}`,
        "Z",
      ].join(" ");

      return `<path d="${path}" fill="${color}">${title}</path>`;
    })
    .join("");

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const summary = `${label}: ${total} over ${data.length} days, from ${shortDate(data[0].day)} to ${shortDate(data[data.length - 1].day)}`;

  return [
    `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(summary)}">`,
    bars,
    // Recessive baseline, so the axis frames the bars without competing with them.
    `<line x1="0" y1="${plotHeight + 0.5}" x2="${width}" y2="${plotHeight + 0.5}" class="chart-axis" />`,
    "</svg>",
  ].join("");
}

/** The last `days` calendar days, inclusive of today, zero-filled. */
export function toDailySeries(dates: Date[], days = 30): DayCount[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const series: DayCount[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return series;
}
