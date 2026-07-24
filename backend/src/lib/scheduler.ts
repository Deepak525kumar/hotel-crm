import { logger } from './logger.js';

/**
 * A recurring job the Platform Worker runs on a fixed interval (ADR-029 §3: the
 * worker "hosts scheduled reminder/escalation jobs"). PR 7.2 provides the
 * registration mechanism only — no domain job is registered yet (the
 * rework-escalation, contract-expiry, and broadcast-auto-close jobs land with
 * their own epics).
 */
export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

interface JobState {
  job: ScheduledJob;
  lastRunAt: number | null;
}

/**
 * Minimal in-process scheduler driven by the worker's poll loop: on each
 * `tick`, every registered job whose interval has elapsed is run once. A job
 * that throws is logged and isolated — it never aborts the tick or other jobs.
 * Not a cron engine (no wall-clock alignment); "run every N ms" is sufficient
 * for the reminder/escalation jobs ADR-029 describes.
 */
export class Scheduler {
  private readonly states: JobState[] = [];

  register(job: ScheduledJob): this {
    if (this.states.some((s) => s.job.name === job.name)) {
      throw new Error(`Scheduled job already registered: ${job.name}`);
    }
    this.states.push({ job, lastRunAt: null });
    return this;
  }

  registeredJobNames(): string[] {
    return this.states.map((s) => s.job.name);
  }

  /** Run every job whose interval has elapsed since its last run. */
  async tick(now: number = Date.now()): Promise<void> {
    for (const state of this.states) {
      const due = state.lastRunAt === null || now - state.lastRunAt >= state.job.intervalMs;
      if (!due) continue;
      state.lastRunAt = now;
      try {
        await state.job.run();
      } catch (error) {
        logger.error('Scheduled job failed', {
          job: state.job.name,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
  }
}
