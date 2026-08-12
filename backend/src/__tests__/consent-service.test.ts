import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015 bounded context; ADR-037/GD-17
 * lifecycle & fail-safety): service-level regression for IF-CONSENT-*.
 */

const mockConsentRecordCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockConsentRecordFindFirst = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockConsentRecordFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockConsentRecordCount = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelGroupFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockNotificationEnqueue = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../lib/db.js', () => {
  const db = {
    consentRecord: {
      create: mockConsentRecordCreate,
      findFirst: mockConsentRecordFindFirst,
      findMany: mockConsentRecordFindMany,
      count: mockConsentRecordCount,
    },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    hotelGroup: { findUnique: mockHotelGroupFindUnique },
    auditLog: { create: mockAuditLogCreate },
  };
  return {
    getPrisma: () => ({ ...db, $transaction: async (cb: any) => cb(db) }),
  };
});

jest.mock('../modules/notifications/service.js', () => ({
  notificationService: { enqueue: mockNotificationEnqueue },
}));

import { ConsentService } from '../modules/consent/service.js';
import { ForbiddenError, ValidationError } from '../lib/errors.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    worker_id: 'w1',
    consent_instance: 'daily-access-gate',
    notice_version: 'v1',
    decision: 'GRANTED',
    decided_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

describe('ConsentService (SPEC-CONSENT-001)', () => {
  let service: ConsentService;

  beforeEach(() => {
    service = new ConsentService();
    mockConsentRecordCreate.mockReset();
    mockConsentRecordFindFirst.mockReset();
    mockConsentRecordFindMany.mockReset();
    mockConsentRecordCount.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockHotelGroupFindUnique.mockReset();
    mockAuditLogCreate.mockReset();
    mockNotificationEnqueue.mockReset();
  });

  describe('checkStatus — RULE-CONSENT-01/02/06', () => {
    it('returns absent when no record exists', async () => {
      mockConsentRecordFindFirst.mockResolvedValue(null);
      const result = await service.checkStatus('w1', 'daily-access-gate');
      expect(result).toEqual({ status: 'absent' });
    });

    it('returns granted for a today-dated GRANTED record at the current notice version', async () => {
      mockConsentRecordFindFirst.mockResolvedValue(
        makeRecord({ decided_at: new Date(), notice_version: 'v1' })
      );
      const result = await service.checkStatus('w1', 'daily-access-gate');
      expect(result.status).toBe('granted');
    });

    it('returns absent (requires fresh acceptance) when the GRANTED record is from a prior calendar day', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      mockConsentRecordFindFirst.mockResolvedValue(
        makeRecord({ decided_at: yesterday, notice_version: 'v1' })
      );
      const result = await service.checkStatus('w1', 'daily-access-gate');
      expect(result.status).toBe('absent');
    });

    it('returns absent when the GRANTED record is dated today but at a superseded notice version', async () => {
      mockConsentRecordFindFirst.mockResolvedValue(
        makeRecord({ decided_at: new Date(), notice_version: 'v0-superseded' })
      );
      const result = await service.checkStatus('w1', 'daily-access-gate');
      expect(result.status).toBe('absent');
    });

    it('returns declined for a DECLINED record', async () => {
      mockConsentRecordFindFirst.mockResolvedValue(makeRecord({ decision: 'DECLINED' }));
      const result = await service.checkStatus('w1', 'daily-access-gate');
      expect(result.status).toBe('declined');
    });

    it('returns absent for a WITHDRAWN record (even if dated today)', async () => {
      mockConsentRecordFindFirst.mockResolvedValue(
        makeRecord({ decision: 'WITHDRAWN', decided_at: new Date() })
      );
      const result = await service.checkStatus('w1', 'daily-access-gate');
      expect(result.status).toBe('absent');
    });

    // Timezone fix (2026-08-08): isSameCalendarDay previously compared
    // getUTCFullYear/getUTCMonth/getUTCDate, disagreeing with the rest of
    // the platform's Europe/Berlin day anchor (calendar/service.ts's
    // CALENDAR_TIMEZONE, OD-CAL-04) for part of every day (the CET/CEST
    // offset). These two instants are on DIFFERENT UTC calendar dates but
    // the SAME Berlin calendar date (2026-01-15 CET, UTC+1) -- the old
    // getUTC*-based comparison would have called them different days.
    it('treats two instants as the same day when they share a Berlin calendar date but differ in UTC (timezone fix)', async () => {
      const lateBerlinEvening = new Date('2026-01-15T23:30:00+01:00'); // 22:30 UTC, still Jan 15 in Berlin
      const earlyBerlinMorning = new Date('2026-01-15T00:30:00+01:00'); // 2026-01-14T23:30:00Z -- Jan 14 in UTC, Jan 15 in Berlin
      mockConsentRecordFindFirst.mockResolvedValue(
        makeRecord({ decided_at: earlyBerlinMorning, notice_version: 'v1' })
      );
      jest.useFakeTimers({ now: lateBerlinEvening, doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const result = await service.checkStatus('w1', 'daily-access-gate');
        expect(result.status).toBe('granted');
      } finally {
        jest.useRealTimers();
      }
    });

    it('treats two instants on the same UTC calendar date but different Berlin dates as different days (timezone fix)', async () => {
      // 2026-01-15T00:30:00Z is Jan 15 in UTC but still Jan 14 in Berlin (01:30 CET).
      // 2026-01-15T23:30:00Z is Jan 15 in UTC AND Jan 16 in Berlin (00:30 CET, past midnight).
      const decidedAt = new Date('2026-01-15T00:30:00Z');
      const checkedAt = new Date('2026-01-15T23:30:00Z');
      mockConsentRecordFindFirst.mockResolvedValue(
        makeRecord({ decided_at: decidedAt, notice_version: 'v1' })
      );
      jest.useFakeTimers({ now: checkedAt, doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const result = await service.checkStatus('w1', 'daily-access-gate');
        expect(result.status).toBe('absent');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('requestConsent — OD-CONSENT-009/ADR-037 (language fallback)', () => {
    it('returns notice content in the requested supported language', async () => {
      const result = await service.requestConsent('daily-access-gate', 'fr');
      expect(result.language).toBe('fr');
      expect(result.rtl).toBe(false);
    });

    it('falls back to the platform-default language for an unsupported/missing language', async () => {
      const result = await service.requestConsent('daily-access-gate', 'klingon');
      expect(result.language).toBe('de');
    });

    it('flags rtl for Arabic and Urdu', async () => {
      const ar = await service.requestConsent('daily-access-gate', 'ar');
      expect(ar.rtl).toBe(true);
      const ur = await service.requestConsent('daily-access-gate', 'ur');
      expect(ur.rtl).toBe(true);
    });
  });

  describe('recordDecision — RULE-CONSENT-01/02/03/05', () => {
    it('rejects a decision submitted against a stale/superseded notice version (OD-CONSENT-004/ADR-037)', async () => {
      await expect(
        service.recordDecision('w1', 'worker', {
          consent_instance: 'daily-access-gate',
          decision: 'GRANTED',
          notice_version: 'v0-stale',
        })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockConsentRecordCreate).not.toHaveBeenCalled();
    });

    it('records a GRANTED decision and writes exactly one immutable audit entry, no manager notification', async () => {
      mockConsentRecordCreate.mockResolvedValue(makeRecord({ decision: 'GRANTED' }));

      const result = await service.recordDecision('w1', 'worker', {
        consent_instance: 'daily-access-gate',
        decision: 'GRANTED',
        notice_version: 'v1',
      });

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'CONSENT_GRANTED' }) })
      );
      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
      expect(result.decision).toBe('GRANTED');
    });

    it('records a DECLINED decision, writes an audit entry, AND notifies the responsible manager (RULE-CONSENT-03: both facts fire together)', async () => {
      mockConsentRecordCreate.mockResolvedValue(makeRecord({ decision: 'DECLINED' }));
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      const result = await service.recordDecision('w1', 'worker', {
        consent_instance: 'daily-access-gate',
        decision: 'DECLINED',
        notice_version: 'v1',
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'CONSENT_DECLINED' }) })
      );
      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'rm1', type: 'CONSENT_DECLINED' }),
        expect.anything()
      );
      expect(result.decision).toBe('DECLINED');
    });

    it('sends no manager notification for an unassigned/inactive worker on decline (best-effort, no fallback -- OD-CONSENT-008 posture)', async () => {
      mockConsentRecordCreate.mockResolvedValue(makeRecord({ decision: 'DECLINED' }));
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'INACTIVE', hotel_group_id: null });

      await service.recordDecision('w1', 'worker', {
        consent_instance: 'daily-access-gate',
        decision: 'DECLINED',
        notice_version: 'v1',
      });

      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('withdrawConsent — RULE-CONSENT-05, OD-CONSENT-001/ADR-037', () => {
    it('creates a WITHDRAWN record and writes an audit entry', async () => {
      mockConsentRecordCreate.mockResolvedValue(makeRecord({ decision: 'WITHDRAWN' }));

      const result = await service.withdrawConsent('w1', 'worker', 'daily-access-gate');

      expect(mockConsentRecordCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decision: 'WITHDRAWN' }) })
      );
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'CONSENT_WITHDRAWN' }) })
      );
      expect(result.decision).toBe('WITHDRAWN');
    });
  });

  describe('getAuditHistory — RULE-CONSENT-08, OD-CONSENT-011/ADR-037', () => {
    it('allows a worker to read their own history', async () => {
      mockConsentRecordFindMany.mockResolvedValue([makeRecord()]);
      mockConsentRecordCount.mockResolvedValue(1);

      const result = await service.getAuditHistory(
        { worker_id: 'w1', page: 1, per_page: 20 },
        { userId: 'w1', role: 'worker' }
      );

      expect(result.total).toBe(1);
    });

    it('denies a worker reading another worker\'s history', async () => {
      await expect(
        service.getAuditHistory(
          { worker_id: 'w2', page: 1, per_page: 20 },
          { userId: 'w1', role: 'worker' }
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockConsentRecordFindMany).not.toHaveBeenCalled();
    });

    it('allows Admin to read any worker\'s history (rides Compliance\'s governance-read path, OD-CONSENT-011)', async () => {
      mockConsentRecordFindMany.mockResolvedValue([]);
      mockConsentRecordCount.mockResolvedValue(0);

      await service.getAuditHistory(
        { worker_id: 'w2', page: 1, per_page: 20 },
        { userId: 'admin1', role: 'admin' }
      );

      expect(mockConsentRecordFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ worker_id: 'w2' }) })
      );
    });

    it('bounds the query with pagination (skip/take), never an unbounded scan', async () => {
      mockConsentRecordFindMany.mockResolvedValue([]);
      mockConsentRecordCount.mockResolvedValue(0);

      await service.getAuditHistory(
        { worker_id: 'w1', page: 2, per_page: 10 },
        { userId: 'w1', role: 'worker' }
      );

      expect(mockConsentRecordFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });
  });
});
