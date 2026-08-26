import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';
import { assignmentService } from './service.js';

export interface AssignmentNoShowJobConfig {
  intervalMs: number;
  gracePeriodMs: number;
  batchSize?: number;
}

export class AssignmentNoShowJob implements ScheduledJob {
  readonly name = 'assignment-no-show';
  readonly intervalMs: number;
  private readonly gracePeriodMs: number;
  private readonly batchSize: number;

  constructor(config: AssignmentNoShowJobConfig) {
    this.intervalMs = config.intervalMs;
    this.gracePeriodMs = config.gracePeriodMs;
    this.batchSize = config.batchSize ?? 100;
  }

  async run(): Promise<void> {
    const closed = await assignmentService.sweepNoShows(this.gracePeriodMs, this.batchSize);
    if (closed > 0) {
      logger.info('Assignment No Show sweep completed', { assignments_marked: closed });
    }
  }
}
