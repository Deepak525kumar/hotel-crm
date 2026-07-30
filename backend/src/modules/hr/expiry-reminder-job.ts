import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';
import { hrService } from './service.js';

export interface HrContractExpiryReminderJobConfig {
  intervalMs: number;
  batchSize: number;
}

/**
 * HR implementation PR 5 (IF-HR-ContractExpiryReminder, RULE-HR-07): notifies
 * the responsible manager as a contract approaches its 1yr/2yr mark. Mirrors
 * JobRequestAutoCloseJob's/SessionSweepJob's/GeoRetentionSweepJob's exact
 * shape (name/intervalMs/run()), confirming ADR-057's
 * Platform-Worker-not-BullMQ decision in code — no new job runtime is
 * introduced. Like JobRequestAutoCloseJob, no constructor-injected
 * PrismaClient is needed: hrService (the module's exported singleton)
 * resolves the shared Prisma client itself via BaseService.
 */
export class HrContractExpiryReminderJob implements ScheduledJob {
  readonly name = 'hr-contract-expiry-reminder';
  readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(config: HrContractExpiryReminderJobConfig) {
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;
  }

  async run(): Promise<void> {
    // Looks 24h ahead of "now" so a daily sweep (the default interval)
    // reliably catches a mark before it passes, rather than only after.
    const withinMs = 24 * 60 * 60 * 1000;
    const sent = await hrService.sendExpiryReminders(withinMs, this.batchSize);
    logger.info('HR contract expiry reminder sweep completed', { reminders_sent: sent });
  }
}
