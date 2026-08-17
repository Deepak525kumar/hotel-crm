import { describe, it, expect } from '@jest/globals';
import {
  RecordDecisionSchema,
  WithdrawConsentSchema,
  CheckStatusQuerySchema,
  GetAuditHistoryQuerySchema,
  SUPPORTED_LANGUAGES,
  RTL_LANGUAGES,
  DEFAULT_LANGUAGE,
} from '../modules/consent/types.js';

describe('RecordDecisionSchema', () => {
  it('accepts a valid GRANTED decision', () => {
    const result = RecordDecisionSchema.safeParse({
      consent_instance: 'daily-access-gate',
      decision: 'GRANTED',
      notice_version: 'v1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid DECLINED decision', () => {
    const result = RecordDecisionSchema.safeParse({
      consent_instance: 'daily-access-gate',
      decision: 'DECLINED',
      notice_version: 'v1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a decision value outside GRANTED/DECLINED (RULE-CONSENT-01: this endpoint only records the initial grant/decline)', () => {
    const result = RecordDecisionSchema.safeParse({
      consent_instance: 'daily-access-gate',
      decision: 'WITHDRAWN',
      notice_version: 'v1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing consent_instance', () => {
    const result = RecordDecisionSchema.safeParse({ decision: 'GRANTED', notice_version: 'v1' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing notice_version', () => {
    const result = RecordDecisionSchema.safeParse({
      consent_instance: 'daily-access-gate',
      decision: 'GRANTED',
    });
    expect(result.success).toBe(false);
  });
});

describe('WithdrawConsentSchema', () => {
  it('accepts a valid withdrawal request', () => {
    const result = WithdrawConsentSchema.safeParse({ consent_instance: 'daily-access-gate' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing consent_instance', () => {
    const result = WithdrawConsentSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('CheckStatusQuerySchema', () => {
  it('accepts a valid query', () => {
    const result = CheckStatusQuerySchema.safeParse({ consent_instance: 'daily-access-gate' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing consent_instance', () => {
    const result = CheckStatusQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('GetAuditHistoryQuerySchema — bounded/paginated (G4 Performance Review correction, v0.1.1)', () => {
  it('applies default pagination', () => {
    const result = GetAuditHistoryQuerySchema.parse({ worker_id: 'w1' });
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(20);
  });

  it('rejects per_page above the max (100) -- no unbounded full-history scan', () => {
    const result = GetAuditHistoryQuerySchema.safeParse({ worker_id: 'w1', per_page: 500 });
    expect(result.success).toBe(false);
  });

  it('accepts an optional date range and consent_instance filter', () => {
    const result = GetAuditHistoryQuerySchema.safeParse({
      worker_id: 'w1',
      consent_instance: 'daily-access-gate',
      from: '2026-01-01',
      to: '2026-07-30',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing worker_id', () => {
    const result = GetAuditHistoryQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('constants', () => {
  // CRR §32's original 12, plus `uk` added by ADR-068 (SIR-CONSENT-012).
  it('SUPPORTED_LANGUAGES matches CRR §32 + ADR-068 (13 supported languages)', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(13);
    expect(SUPPORTED_LANGUAGES).toContain('de');
    expect(SUPPORTED_LANGUAGES).toContain('ar');
    expect(SUPPORTED_LANGUAGES).toContain('ur');
    expect(SUPPORTED_LANGUAGES).toContain('uk');
  });

  it('RTL_LANGUAGES is exactly Arabic and Urdu (CRR §32 line 381)', () => {
    expect(RTL_LANGUAGES).toEqual(['ar', 'ur']);
  });

  it('DEFAULT_LANGUAGE is a supported language', () => {
    expect(SUPPORTED_LANGUAGES).toContain(DEFAULT_LANGUAGE);
  });
});
