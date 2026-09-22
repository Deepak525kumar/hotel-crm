import { addDays } from './agenda';

/**
 * The web caps weekly recurrence at 26 occurrences. Matched here rather than
 * chosen: a different cap on mobile would make the same form produce
 * different rotas depending on which client a manager happened to use.
 */
export const MAX_OCCURRENCES = 26;

/** The days a weekly recurrence covers, starting at `from` inclusive. */
export function weeklyOccurrences(from: string, weeks: number): string[] {
  const capped = Math.max(1, Math.min(weeks, MAX_OCCURRENCES));
  return Array.from({ length: capped }, (_, i) => addDays(from, i * 7));
}

export type OccurrenceOutcome = {
  day: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
};

/**
 * Whether a finished run should be reported as success.
 *
 * ONLY when every occurrence landed. A run where 19 of 26 succeeded is a
 * PARTIAL result, and reporting it as success would have the manager believe
 * 26 shifts exist when 19 do — discovered when nobody turns up for the other
 * seven. This is the single reason the progress sheet exists rather than a
 * toast.
 */
export function isCompleteSuccess(outcomes: readonly OccurrenceOutcome[]): boolean {
  return outcomes.length > 0 && outcomes.every((o) => o.state === 'done');
}

/** A short, honest summary of a finished or cancelled run. */
export function summarise(outcomes: readonly OccurrenceOutcome[]): {
  done: number;
  failed: number;
  notAttempted: number;
} {
  return {
    done: outcomes.filter((o) => o.state === 'done').length,
    failed: outcomes.filter((o) => o.state === 'failed').length,
    // Cancelling mid-run leaves occurrences that were never tried. They are
    // neither successes nor failures, and collapsing them into either would
    // misreport what happened to the rota.
    notAttempted: outcomes.filter((o) => o.state === 'pending').length,
  };
}
