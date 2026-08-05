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
 * Today's date in the browser's LOCAL timezone, as YYYY-MM-DD -- for
 * comparing against/setting the `min` of a `type="date"` input, whose own
 * `.value` is always local, never UTC.
 *
 * `new Date().toISOString().slice(0, 10)` is a common but incorrect
 * shortcut: `toISOString()` always returns the UTC date, which disagrees
 * with the local date for roughly a third of the day in any timezone west
 * of UTC (e.g. in New York, from 8pm to midnight local time, the UTC date
 * has already rolled over to tomorrow) -- a "cannot be in the past" check
 * built on it incorrectly rejects TODAY's date during exactly that window.
 * `toLocaleDateString("en-CA")` is used instead purely for its YYYY-MM-DD
 * output format (en-CA is the one common locale with that ISO-like default,
 * not because this only makes sense for Canadian users) -- it operates on
 * the Date's local representation, matching what a date input actually
 * produces.
 */
export function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
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
