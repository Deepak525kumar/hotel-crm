/**
 * Presentation-layer formatting helpers. Centralised so date/number rendering
 * stays consistent across detail views and tables.
 */

/** Formats an ISO timestamp as a localized date + time, or "—" when absent. */
export function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

/** Formats an ISO timestamp as a localized date, or "—" when absent. */
export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

/**
 * Formats a already-scaled percentage (0–100 from the analytics API) with a
 * `%` suffix, trimming a trailing `.0`. Returns "—" for nullish input.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/** Formats a numeric score to `digits` decimals, or "—" when nullish. */
export function formatScore(
  value: number | null | undefined,
  digits = 1,
): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}
