import { ConsentDecision, OutboxSourceModule, OutboxTransport, Prisma } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { invalidateConsentCache } from '../../lib/consent-gate-cache.js';
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

// DPO-authored legal notice (FHM Hotelservice GmbH, Stand: Juni 2026),
// replacing the structural placeholder that previously stood in this slot.
// Provided in German only -- SUPPORTED_LANGUAGES' other 12 entries fall back
// to this text until a per-language translation is authored, same as any
// other language absent from a NOTICE_CONTENT entry would (OD-CONSENT-009's
// DEFAULT_LANGUAGE fallback covers the client-preferred-language case; this
// covers the notice-content case, since only one legally-reviewed copy
// exists so far).
const GERMAN_NOTICE_TEXT = `Datenschutzinformation nach Art. 13 DSGVO – FHM Hotelservice GmbH

Information über die Verarbeitung personenbezogener Daten gemäß Art. 13 und Art. 14 der Datenschutz-Grundverordnung (DSGVO) in Verbindung mit § 26 Bundesdatenschutzgesetz (BDSG)

Mit dieser Information klären wir Sie als Beschäftigte bzw. Bewerberin oder Beschäftigten bzw. Bewerber darüber auf, welche personenbezogenen Daten wir im Rahmen der Begründung, Durchführung und Beendigung Ihres Beschäftigungsverhältnisses erheben und verarbeiten, zu welchen Zwecken und auf welcher Rechtsgrundlage dies geschieht und welche Rechte Ihnen zustehen. Bitte lesen Sie diese Information aufmerksam durch und bestätigen Sie den Erhalt am Ende dieses Dokuments.

1. Verantwortlicher für die Datenverarbeitung
Verantwortlich für die Verarbeitung Ihrer personenbezogenen Daten im Sinne des Art. 4 Nr. 7 DSGVO ist:
FHM Hotelservice GmbH
Berner Str. 38
60437 Frankfurt am Main
Vertreten durch die Geschäftsführerin: Frau Snezhana Todorova
Telefon: +49 160 97044182 · E-Mail: info@deepcleaninghub.com

2. Datenschutzbeauftragter / Ansprechpartner für den Datenschutz
Bei Fragen zum Datenschutz und zur Wahrnehmung Ihrer Rechte können Sie sich an folgende Stelle wenden:
• Sofern ein Datenschutzbeauftragter bestellt ist: [Name / Funktion], [Anschrift], E-Mail: [datenschutz@…]
• Andernfalls erreichen Sie den für den Datenschutz Verantwortlichen über die unter Ziffer 1 genannten Kontaktdaten.
Hinweis: Die Bestellung eines Datenschutzbeauftragten ist nach § 38 BDSG verpflichtend, sobald in der Regel mindestens 20 Personen ständig mit der automatisierten Verarbeitung personenbezogener Daten beschäftigt sind oder eine Datenschutz-Folgenabschätzung erforderlich ist.

3. Zwecke der Verarbeitung und Rechtsgrundlagen
Wir verarbeiten Ihre personenbezogenen Daten ausschließlich zu festgelegten, eindeutigen und legitimen Zwecken:
• Begründung, Durchführung und Beendigung des Beschäftigungsverhältnisses (z. B. Bewerbung, Arbeitsvertrag, Einsatzplanung, Arbeitszeiterfassung, Leistungs- und Verhaltensbeurteilung) — § 26 Abs. 1 BDSG; Art. 6 Abs. 1 lit. b DSGVO
• Lohn- und Gehaltsabrechnung sowie Erfüllung steuer- und sozialversicherungsrechtlicher Pflichten — Art. 6 Abs. 1 lit. c DSGVO; § 26 BDSG
• Erfüllung gesetzlicher Pflichten (z. B. Nachweisgesetz, Mindestlohngesetz, Arbeitsschutz, Aufbewahrungspflichten) — Art. 6 Abs. 1 lit. c DSGVO
• Wahrung berechtigter Interessen (z. B. IT-Sicherheit, Geltendmachung oder Abwehr von Rechtsansprüchen, Organisation des Betriebs) — Art. 6 Abs. 1 lit. f DSGVO
• Verarbeitung besonderer Kategorien personenbezogener Daten (z. B. Gesundheitsdaten bei Arbeitsunfähigkeit, Schwerbehinderung) — § 26 Abs. 3 BDSG; Art. 9 Abs. 2 lit. b DSGVO
• Verarbeitungen, die auf Ihrer freiwilligen Einwilligung beruhen (z. B. Mitarbeiterfotos, freiwillige Angaben) — § 26 Abs. 2 BDSG; Art. 6 Abs. 1 lit. a DSGVO

4. Kategorien der verarbeiteten personenbezogenen Daten
Je nach Stand des Beschäftigungsverhältnisses verarbeiten wir insbesondere folgende Datenkategorien:
• Stammdaten: Name, Geburtsdatum, Geburtsort, Anschrift, Staatsangehörigkeit, Familienstand, Kontaktdaten
• Vertrags- und Abrechnungsdaten: Eintrittsdatum, Funktion/Tätigkeit, Einsatzort, Arbeitszeiten, Vergütung, Bankverbindung, Steuer-ID, Sozialversicherungsnummer, Krankenkasse, Konfession (für Kirchensteuer)
• Qualifikations- und Leistungsdaten: Zeugnisse, Qualifikationen, Beurteilungen, Fehlzeiten
• Aufenthalts- und Arbeitserlaubnisdaten (soweit erforderlich) sowie Ausweisdaten
• Besondere Kategorien (Art. 9 DSGVO): Gesundheitsdaten (z. B. Arbeitsunfähigkeitsbescheinigungen), Daten zu einer Schwerbehinderung – nur soweit gesetzlich erforderlich

5. Herkunft der Daten
Wir verarbeiten überwiegend Daten, die wir unmittelbar von Ihnen erhalten. Soweit dies für die Durchführung des Beschäftigungsverhältnisses erforderlich ist, verarbeiten wir auch Daten, die wir zulässigerweise von Dritten (z. B. von einem früheren Arbeitgeber, von Behörden oder aus öffentlich zugänglichen Quellen) erhalten haben (Art. 14 DSGVO).

6. Empfänger bzw. Kategorien von Empfängern
Innerhalb des Unternehmens erhalten nur die Stellen Zugriff auf Ihre Daten, die diese zur Erfüllung ihrer Aufgaben benötigen. Eine Weitergabe an externe Empfänger erfolgt nur, soweit dies gesetzlich vorgeschrieben oder zulässig ist. Empfänger können insbesondere sein:
• Finanzbehörden (Finanzamt), Träger der Sozialversicherung, Krankenkassen, Berufsgenossenschaft
• Steuerberater bzw. Lohnabrechnungsstelle (als Auftragsverarbeiter nach Art. 28 DSGVO)
• Banken zur Durchführung des Zahlungsverkehrs (Gehaltsüberweisung)
• Auftraggeber bzw. Kunden im Rahmen des Einsatzes (z. B. Zutritts- und Sicherheitslisten in Hotelobjekten), soweit erforderlich
• IT-Dienstleister sowie Anbieter cloudbasierter Personal- und Buchhaltungssoftware (als Auftragsverarbeiter nach Art. 28 DSGVO)
• Gerichte, Rechtsanwälte und Behörden, soweit zur Wahrung von Rechten erforderlich

7. Übermittlung an Drittländer
Eine Übermittlung Ihrer Daten in ein Land außerhalb der Europäischen Union bzw. des Europäischen Wirtschaftsraums (Drittland) ist grundsätzlich nicht vorgesehen. Sollte im Einzelfall eine Übermittlung erfolgen (z. B. durch den Einsatz von IT-Dienstleistern), geschieht dies nur unter den Voraussetzungen der Art. 44 ff. DSGVO, insbesondere auf Grundlage eines Angemessenheitsbeschlusses der EU-Kommission oder geeigneter Garantien (z. B. EU-Standardvertragsklauseln).

8. Dauer der Speicherung
Wir verarbeiten und speichern Ihre Daten für die Dauer des Beschäftigungsverhältnisses. Darüber hinaus speichern wir Daten nur, solange gesetzliche Aufbewahrungs- oder Nachweispflichten bestehen oder die Daten zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen erforderlich sind. Maßgeblich sind insbesondere die handels- und steuerrechtlichen Aufbewahrungsfristen (in der Regel 6 bzw. 10 Jahre nach § 257 HGB und § 147 AO). Bewerberdaten werden bei einer Absage regelmäßig nach spätestens 6 Monaten gelöscht, sofern Sie keiner längeren Speicherung zugestimmt haben.

9. Ihre Rechte als betroffene Person
Ihnen stehen gegenüber dem Verantwortlichen folgende Rechte hinsichtlich Ihrer personenbezogenen Daten zu:
• Auskunft über die zu Ihrer Person gespeicherten Daten (Art. 15 DSGVO)
• Berichtigung unrichtiger oder Vervollständigung unvollständiger Daten (Art. 16 DSGVO)
• Löschung Ihrer Daten, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht (Art. 17 DSGVO)
• Einschränkung der Verarbeitung (Art. 18 DSGVO)
• Datenübertragbarkeit der von Ihnen bereitgestellten Daten (Art. 20 DSGVO)
• Widerspruch gegen Verarbeitungen, die auf Art. 6 Abs. 1 lit. f DSGVO beruhen, aus Gründen Ihrer besonderen Situation (Art. 21 DSGVO)

10. Widerruf einer Einwilligung
Soweit eine Verarbeitung auf Ihrer Einwilligung beruht (Art. 6 Abs. 1 lit. a, Art. 9 Abs. 2 lit. a DSGVO, § 26 Abs. 2 BDSG), haben Sie das Recht, diese Einwilligung jederzeit mit Wirkung für die Zukunft zu widerrufen. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung bleibt davon unberührt. Ein Widerruf ist formlos gegenüber den unter Ziffer 1 genannten Kontaktdaten möglich.

11. Beschwerderecht bei einer Aufsichtsbehörde
Unbeschadet anderweitiger Rechtsbehelfe steht Ihnen ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde zu (Art. 77 DSGVO), insbesondere bei der Aufsichtsbehörde Ihres Wohnsitzes oder des Sitzes des Verantwortlichen. Zuständig für die FHM Hotelservice GmbH ist:
Der Hessische Beauftragte für Datenschutz und Informationsfreiheit (HBDI)
Postfach 3163, 65021 Wiesbaden · E-Mail: poststelle@datenschutz.hessen.de

12. Pflicht zur Bereitstellung der Daten
Die Bereitstellung bestimmter personenbezogener Daten ist gesetzlich oder vertraglich vorgeschrieben bzw. für den Abschluss und die Durchführung des Beschäftigungsverhältnisses erforderlich. Werden diese Daten nicht bereitgestellt, kann das Beschäftigungsverhältnis ggf. nicht begründet oder fortgeführt werden bzw. können gesetzliche Pflichten (z. B. die Lohnabrechnung) nicht erfüllt werden. Freiwillige Angaben sind als solche gekennzeichnet.

13. Automatisierte Entscheidungsfindung und Profiling
Eine ausschließlich auf einer automatisierten Verarbeitung – einschließlich Profiling – beruhende Entscheidung im Sinne des Art. 22 DSGVO, die Ihnen gegenüber rechtliche Wirkung entfaltet oder Sie in ähnlicher Weise erheblich beeinträchtigt, findet nicht statt.

FHM Hotelservice GmbH · Frankfurt am Main · Stand: Juni 2026`;

const NOTICE_CONTENT: Record<SupportedLanguage, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((lang) => [lang, GERMAN_NOTICE_TEXT])
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

    // Drop any cached grant so the gate re-reads the real state on the very
    // next request. Belt-and-braces: only grants are cached, so a DECLINED
    // could not have been cached anyway -- but this keeps the "accepted and
    // still locked" class of bug impossible by construction rather than by
    // reasoning about what the cache happens to hold.
    invalidateConsentCache(workerId);

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

    // A withdrawal must take effect immediately, not after the cache TTL.
    invalidateConsentCache(workerId);

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

// Exported so the consent-gate middleware's cache can key on the same
// Berlin calendar date this module uses to decide "today". A second,
// independently-written Intl.DateTimeFormat in the middleware would be
// exactly the kind of duplicate that drifts -- and a drift here means the
// gate and the status query disagree about what day it is.
export function consentCalendarDate(d: Date): string {
  return calendarDateInZone(d);
}

// The current daily-access-gate notice version, exported for the same
// reason: the gate's cache must invalidate when a version bump supersedes
// an existing grant (RULE-CONSENT-02).
export function currentNoticeVersion(): string {
  return CURRENT_NOTICE_VERSION;
}

function calendarDateInZone(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONSENT_TIMEZONE }).format(d);
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return calendarDateInZone(a) === calendarDateInZone(b);
}

export { CONSENT_INSTANCE };
export const consentService = new ConsentService();
