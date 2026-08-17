export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// expires_at is YYYY-MM-DD (date-only); parsing/formatting as UTC avoids a
// local-timezone off-by-one when the device's own timezone differs (same
// reasoning as lib/calendar-dates.ts's formatDay).
export function formatExpiry(expiresAt: string): string {
  return new Date(`${expiresAt}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
