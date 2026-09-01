import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';
import { assignmentService } from './service.js';

export interface ShiftReminderJobConfig {
  intervalMs: number;
}

export class ShiftReminderJob implements ScheduledJob {
  readonly name = 'shift-reminder';
  readonly intervalMs: number;

  constructor(config: ShiftReminderJobConfig) {
    this.intervalMs = config.intervalMs;
  }

  async run(): Promise<void> {
    const notified = await assignmentService.sweepShiftReminders();
    if (notified > 0) {
      logger.info('Shift reminder sweep completed', { workers_notified: notified });
    }
  }
}
