/**
 * Formats a rate the API expresses as a number into a percentage string.
 *
 * `null`/`undefined` becomes an em dash, never "0%". The distinction is the
 * whole reason this helper exists: `quality.average_score` is genuinely
 * nullable (no verifications yet), and rendering that as 0% tells a manager
 * their hotel scored zero when in fact nothing has been inspected. One reads
 * as a crisis and the other as a quiet week.
 *
 * Accepts both conventions because the API mixes them: `on_time_rate` and
 * `pass_rate` come back as 0-100 already, so anything <= 1 is treated as a
 * fraction and scaled. A true 1% rate renders as 100%, which is the one wrong
 * case -- accepted deliberately over the alternative, which is every healthy
 * rate between 0 and 1 rendering as a fraction of a percent.
 */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const scaled = value <= 1 ? value * 100 : value;
  return `${Math.round(scaled)}%`;
}

/** A nullable average score, to one decimal. Em dash when never scored. */
export function score(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(1);
}
