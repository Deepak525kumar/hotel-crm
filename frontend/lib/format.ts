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
