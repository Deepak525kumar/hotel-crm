import { ConsentDecision, OutboxSourceModule, OutboxTransport, Prisma } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { notificationService } from '../notifications/service.js';
import {
  CONSENT_INSTANCE,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  RTL_LANGUAGES,
  type SupportedLanguage,
  type ConsentStatus,
  type ConsentRecordDto,
  type RecordDecisionInput,
  type GetAuditHistoryQuery,
} from './types.js';

// SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015 bounded context; ADR-037/GD-17
// lifecycle & fail-safety). ADR-015 Decision items 1-6: backend-consent is
// the exclusive owner of consent lifecycle/records/versions/withdrawal/
// renewal/audit history platform-wide -- no other module persists a
// competing consent-state model (RULE-CONSENT-09).
//
// OD-CONSENT-005/ADR-032: no event bus exists; every EVT-CONSENT-* in the
// spec's Events section is realized here as a direct in-process return
// value/notification enqueue, not a published domain event -- the same
// transport convention every other module in this repository already uses.
//
// Current notice version. This module stores/versions notice content; it
// does not author the legal text itself (CRR §24's Zirove-flagged
// legal-mismatch concern is a Compliance/DPO question, not resolved here).
// Bumping this constant is how a new notice version is published --
// RULE-CONSENT-02's "new notice version always requires fresh acceptance"
// falls directly out of comparing a worker's most recent GRANTED row's
// notice_version against this constant.
const CURRENT_NOTICE_VERSION = 'v1';

// PDD/CRR do not supply legal notice copy (Zirove/DPO-authored content is
// out of this module's authorship per the Out of Scope section) -- this is
// a structural placeholder proving the per-language/RTL contract
// (REQ-CONSENT-004/RULE-CONSENT-04), not a claim of legally-reviewed text.
const NOTICE_CONTENT: Record<SupportedLanguage, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((lang) => [
    lang,
    `[${lang}] Data-protection notice (Art. 13 DSGVO), version ${CURRENT_NOTICE_VERSION} -- legal content pending Zirove/DPO authorship.`,
  ])
) as Record<SupportedLanguage, string>;

export interface RequestConsentResult {
  consent_instance: string;
  notice_version: string;
  notice_content: string;
  language: SupportedLanguage;
  rtl: boolean;
}

export class ConsentService extends BaseService {
  // ---------------------------------------------------------------------------
  // IF-CONSENT-CheckStatus (RULE-CONSENT-01/02/06)
  // ---------------------------------------------------------------------------
  // RULE-CONSENT-02: the daily gate requires acceptance once per calendar
  // day -- a worker who granted today is not re-prompted; a new calendar day
  // always requires a fresh acceptance. This is evaluated by finding the
  // most recent record for (worker, instance) and checking whether it is a
  // GRANTED row dated today (server-clock calendar date) with the current
  // notice version, not by persisting a separate "day" concept.
  async checkStatus(workerId: string, consentInstance: string): Promise<ConsentStatus> {
    const record = await this.prisma.consentRecord.findFirst({
      where: { worker_id: workerId, consent_instance: consentInstance },
      orderBy: { decided_at: 'desc' },
    });

    if (!record) return { status: 'absent' };

    if (record.decision === ConsentDecision.WITHDRAWN) return { status: 'absent' };

    if (record.decision === ConsentDecision.DECLINED) {
      return {
        status: 'declined',
        notice_version: record.notice_version,
        decided_at: record.decided_at.toISOString(),
      };
    }

    // GRANTED or RENEWED: valid only if it's today's calendar date and the
    // current notice version (RULE-CONSENT-02: a new day, or a new notice
    // version being published, always requires fresh acceptance).
    const isToday = isSameCalendarDay(record.decided_at, new Date());
    if (isToday && record.notice_version === CURRENT_NOTICE_VERSION) {
      return {
        status: 'granted',
        notice_version: record.notice_version,
        decided_at: record.decided_at.toISOString(),
      };
    }

    return { status: 'absent' };
  }

  // ---------------------------------------------------------------------------
  // IF-CONSENT-RequestConsent (ADR-015 Decision items 2/3: the sole channel
  // through which Onboarding/Chatbot may initiate a consent flow)
  // ---------------------------------------------------------------------------
  // OD-CONSENT-009/ADR-037: falls back to DEFAULT_LANGUAGE if the requested
  // language isn't supported/available, never a silent failure or a block.
  async requestConsent(
    consentInstance: string,
    preferredLanguage?: string
  ): Promise<RequestConsentResult> {
    const language = SUPPORTED_LANGUAGES.includes(preferredLanguage as SupportedLanguage)
      ? (preferredLanguage as SupportedLanguage)
      : DEFAULT_LANGUAGE;

    return {
      consent_instance: consentInstance,
      notice_version: CURRENT_NOTICE_VERSION,
      notice_content: NOTICE_CONTENT[language],
      language,
      rtl: (RTL_LANGUAGES as readonly string[]).includes(language),
    };
  }

  // ---------------------------------------------------------------------------
  // IF-CONSENT-RecordDecision (RULE-CONSENT-01/02/03/05)
  // ---------------------------------------------------------------------------
  // Self-scoped only: workerId is always the authenticated caller's own
  // identity (controller.ts derives it from req.auth.userId), mirroring
  // RULE-HR-14/FIND-SEC-HR-02's identical worker-id-provenance precedent.
  //
  // OD-CONSENT-004/ADR-037: a decision submitted against a stale/superseded
  // notice version is rejected -- the caller must re-fetch the current
  // version and resubmit, consistent with the fail-closed posture
  // (OD-CONSENT-006): an ambiguous consent state is treated as unresolved,
  // not silently accepted.
  async recordDecision(
    workerId: string,
    actorRole: string,
    input: RecordDecisionInput,
    actorIp?: string
  ): Promise<ConsentRecordDto> {
    if (input.notice_version !== CURRENT_NOTICE_VERSION) {
      throw new ValidationError(
        'This decision was submitted against a superseded notice version; re-fetch the current notice and resubmit.'
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.consentRecord.create({
        data: {
          worker_id: workerId,
          consent_instance: input.consent_instance,
          notice_version: input.notice_version,
          decision: input.decision as ConsentDecision,
        },
      });

      // RULE-CONSENT-05: every decision produces exactly one immutable audit
      // entry, mirroring RULE-HR-15's identical trust-boundary treatment.
      await this.logAudit(
        workerId,
        actorRole,
        input.decision === 'GRANTED' ? 'CONSENT_GRANTED' : 'CONSENT_DECLINED',
        'ConsentRecord',
        rec.id,
        { consent_instance: input.consent_instance, notice_version: input.notice_version },
        actorIp,
        undefined,
        undefined,
        tx
      );

      // RULE-CONSENT-03: a decline on the daily gate produces both the
      // access-block fact (returned to the caller, who enforces the block --
      // see Out of Scope) AND a manager-notification fact/event, together --
      // neither may fire without the other.
      if (input.decision === 'DECLINED') {
        await this.notifyResponsibleManager(workerId, rec.id, input.consent_instance, tx);
      }
      return rec;
    });

    logger.info('consent_decision_recorded', {
      recordId: record.id,
      workerId,
      consentInstance: input.consent_instance,
      decision: input.decision,
    });

    return this.toDto(record);
  }

  // ---------------------------------------------------------------------------
  // IF-CONSENT-WithdrawConsent (RULE-CONSENT-05, OD-CONSENT-001/ADR-037)
  // ---------------------------------------------------------------------------
  // Self-scoped only (worker withdraws only their own consent). "Withdrawn"
  // is the general-lifecycle-verb persisted state ADR-037 confirms distinct
  // from the daily gate's own date-computed grant/decline cycle.
  async withdrawConsent(
    workerId: string,
    actorRole: string,
    consentInstance: string,
    actorIp?: string
  ): Promise<ConsentRecordDto> {
    const record = await this.prisma.consentRecord.create({
      data: {
        worker_id: workerId,
        consent_instance: consentInstance,
        notice_version: CURRENT_NOTICE_VERSION,
        decision: ConsentDecision.WITHDRAWN,
      },
    });

    await this.logAudit(
      workerId,
      actorRole,
      'CONSENT_WITHDRAWN',
      'ConsentRecord',
      record.id,
      { consent_instance: consentInstance },
      actorIp
    );

    logger.info('consent_withdrawn', { recordId: record.id, workerId, consentInstance });

    return this.toDto(record);
  }

  // ---------------------------------------------------------------------------
  // IF-CONSENT-GetAuditHistory (RULE-CONSENT-08, OD-CONSENT-011/ADR-037)
  // ---------------------------------------------------------------------------
  // OD-CONSENT-011/ADR-037: no dedicated consent:* RBAC permission is
  // introduced -- Admin access rides the existing governance-read pattern
  // ADR-016 already established for AuditLog (no backend-compliance code
  // exists yet to route through instead). A worker may read only their own
  // history; any other role is denied (self-scope is the sole non-Admin
  // authorization, mirroring RULE-CONSENT-08's Compliance-or-self framing).
  // Bounded/paginated per the spec's own v0.1.1 Performance-review
  // correction -- no unbounded full-history scan.
  async getAuditHistory(
    query: GetAuditHistoryQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: ConsentRecordDto[]; total: number }> {
    if (actor.role !== 'admin' && query.worker_id !== actor.userId) {
      throw new ForbiddenError('Cannot access another worker\'s consent audit history');
    }

    const where = {
      worker_id: query.worker_id,
      ...(query.consent_instance ? { consent_instance: query.consent_instance } : {}),
      ...(query.from || query.to
        ? {
            decided_at: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.consentRecord.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { decided_at: 'desc' },
      }),
      this.prisma.consentRecord.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  // RULE-CONSENT-03: manager-notification fact this module emits on a
  // daily-gate decline; delivery mechanics are Notifications' own concern
  // (Out of Scope). Mirrors HR's notifyResponsibleManager() resolution
  // exactly (EmploymentRecord -> HotelGroup -> regional_manager_user_id),
  // the same "responsible manager" primitive calendar/service.ts and
  // hr/service.ts both already use -- OD-CONSENT-008 (concurrency) is
  // explicitly left unaddressed per the spec's own disclosure, so this is a
  // best-effort, no-fallback resolution, same posture as its precedents.
  private async notifyResponsibleManager(
    workerId: string,
    recordId: string,
    consentInstance: string,
    tx: Prisma.TransactionClient
  ): Promise<void> {
    const employment = await tx.employmentRecord.findUnique({
      where: { user_id: workerId },
      select: { status: true, hotel_group_id: true },
    });
    if (!employment || employment.status !== 'ACTIVE' || !employment.hotel_group_id) return;

    const group = await tx.hotelGroup.findUnique({
      where: { id: employment.hotel_group_id },
      select: { regional_manager_user_id: true },
    });
    if (!group?.regional_manager_user_id) return;

    await notificationService.enqueue({
      recipientId: group.regional_manager_user_id,
      type: 'CONSENT_DECLINED',
      title: 'Consent notice declined',
      message: 'A worker declined the daily data-protection notice.',
      data: { worker_id: workerId, consent_record_id: recordId, consent_instance: consentInstance },
      transports: [OutboxTransport.PUSH],
      sourceModule: OutboxSourceModule.CONSENT,
      producerService: 'ConsentService',
    }, tx);
  }

  private toDto(record: {
    id: string;
    worker_id: string;
    consent_instance: string;
    notice_version: string;
    decision: ConsentDecision;
    decided_at: Date;
  }): ConsentRecordDto {
    return {
      id: record.id,
      worker_id: record.worker_id,
      consent_instance: record.consent_instance,
      notice_version: record.notice_version,
      decision: record.decision,
      decided_at: record.decided_at.toISOString(),
    };
  }
}

// Timezone fix (2026-08-08): compared calendar dates via getUTCFullYear/
// getUTCMonth/getUTCDate, but the rest of the platform anchors "today" to
// Europe/Berlin (calendar/service.ts's CALENDAR_TIMEZONE, OD-CAL-04,
// matching Hotel.timezone's own default). A UTC day boundary disagrees with
// a Berlin day boundary for part of every day (the CET/CEST offset), so a
// worker near midnight Berlin time could be told they'd already granted
// consent "today" when they hadn't (or the reverse) by the rest of the
// platform's clock. Same Intl.DateTimeFormat('en-CA', {timeZone}) approach
// as calendar/service.ts's todayInCalendarTimezone(), applied to an
// arbitrary Date rather than always "now".
const CONSENT_TIMEZONE = 'Europe/Berlin';

function calendarDateInZone(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONSENT_TIMEZONE }).format(d);
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return calendarDateInZone(a) === calendarDateInZone(b);
}

export { CONSENT_INSTANCE };
export const consentService = new ConsentService();
