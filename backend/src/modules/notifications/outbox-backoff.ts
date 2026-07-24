/**
 * Exponential-backoff scheduling for OutboxEvent retries (ADR-029 §6).
 *
 * The backoff schedule is a list of millisecond delays (config
 * OUTBOX_BACKOFF_SCHEDULE_MS, default 1m/5m/15m/1h). Its length also bounds the
 * retry count: a row that has failed more times than there are schedule entries
 * is dead-lettered rather than retried again.
 *
 * `attempts` is the number of delivery attempts already made (0 before the first
 * attempt). After the Nth attempt fails, the delay for the next attempt is
 * `schedule[N-1]` — the first failure waits `schedule[0]`, the second
 * `schedule[1]`, and so on. Once `attempts` exceeds `schedule.length`, no delay
 * remains and the row is terminal (dead-letter).
 */
export interface BackoffOutcome {
  /** true → dead-letter (retries exhausted); false → schedule another retry. */
  deadLetter: boolean;
  /** When set (deadLetter === false), the next attempt's timestamp. */
  nextAttemptAt?: Date;
}

/**
 * Parse the OUTBOX_BACKOFF_SCHEDULE_MS config string (comma-separated ms delays)
 * into a positive-int array. Throws a descriptive Error on empty/invalid input
 * so config validation can fail closed (ADR-029 §6). Extracted as a pure
 * function so it is unit-testable without env.ts's loader plumbing.
 */
export function parseBackoffScheduleMs(raw: string): number[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('must list at least one delay (ms)');
  }
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error('each delay must be a positive integer (ms)');
  }
  return nums;
}

export function computeBackoff(
  attemptsAfterThisFailure: number,
  scheduleMs: readonly number[],
  now: Date = new Date()
): BackoffOutcome {
  // attemptsAfterThisFailure is the post-increment attempt count (>= 1). The
  // delay for the retry following the Nth failure is schedule[N-1].
  if (attemptsAfterThisFailure > scheduleMs.length) {
    return { deadLetter: true };
  }
  const delayMs = scheduleMs[attemptsAfterThisFailure - 1];
  return { deadLetter: false, nextAttemptAt: new Date(now.getTime() + delayMs) };
}
