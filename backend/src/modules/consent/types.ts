// SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015 bounded context; ADR-037/GD-17
// lifecycle & fail-safety resolutions).
// REQ-CONSENT-001..009 / RULE-CONSENT-01..09.

import { z } from 'zod';

// RULE-CONSENT-01: the recurring daily GDPR access-gate instance name.
// OD-CONSENT-002/ADR-037: the one-time chatbot data-processing instance name
// -- not yet consumed by any built module (Onboarding/Chatbot are both
// unbuilt), but the instance identifier is fixed here so a future consumer
// has a stable name to reference.
export const CONSENT_INSTANCE = {
  DAILY_ACCESS_GATE: 'daily-access-gate',
  CHATBOT_DATA_PROCESSING: 'chatbot-data-processing',
} as const;

// CRR §32 (line 379): the platform's supported languages. RTL for Arabic
// and Urdu (line 381). This module owns notice content/version, not
// client-side rendering (RULE-CONSENT-04) -- RTL is a rendering flag the
// notice-content response carries, not something this module executes.
//
// ADR-068 (2026-08-18): `uk` (Ukrainian) appended to CRR §32's original 12,
// making 13. Owner decision: a worker must receive the consent notice in the
// language they selected, whatever it is -- and `uk` is a shippable UI locale
// (lib/locales.ts UI_LOCALES), so leaving it out meant Ukrainian-speaking
// workers silently got a German notice via the DEFAULT_LANGUAGE fallback.
// This is an amendment to frozen SPEC-CONSENT-001@0.2.0, authorized by the
// owner and recorded in ADR-068; it resolves SIR-CONSENT-012.
export const SUPPORTED_LANGUAGES = [
  'de',
  'en',
  'ur',
  'ar',
  'ru',
  'it',
  'pl',
  'tr',
  'fr',
  'es',
  'da',
  'hsb',
  'uk',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const RTL_LANGUAGES: readonly SupportedLanguage[] = ['ar', 'ur'];

// OD-CONSENT-009/ADR-037: platform-default-language fallback when notice
// content is unavailable in a worker's configured/preferred language. The
// specific default was left to implementation by ADR-037 itself; German is
// chosen as the platform's own primary-market language (CRR §32's list
// leads with German; every other module's own defaults --
// Hotel.timezone's "Europe/Berlin" default -- assume a German home market).
export const DEFAULT_LANGUAGE: SupportedLanguage = 'de';

// RULE-CONSENT-05: every decision is immutable. GRANTED/DECLINED are the
// daily gate's own grant/decline outcomes (also usable for any other
// instance's initial decision). WITHDRAWN/RENEWED are OD-CONSENT-001's
// general lifecycle verbs (ADR-037): "Renewed" is a distinct persisted
// decision for the withdrawal/renewal cycle -- NOT used for the daily
// gate's own per-day re-grant, which stays purely date-computed (a fresh
// GRANTED row each calendar day, never a "Renewed" row at that layer).
export const RecordDecisionSchema = z.object({
  consent_instance: z.string().min(1),
  decision: z.enum(['GRANTED', 'DECLINED']),
  notice_version: z.string().min(1),
});
export type RecordDecisionInput = z.infer<typeof RecordDecisionSchema>;

export const WithdrawConsentSchema = z.object({
  consent_instance: z.string().min(1),
});
export type WithdrawConsentInput = z.infer<typeof WithdrawConsentSchema>;

export const CheckStatusQuerySchema = z.object({
  consent_instance: z.string().min(1),
});
export type CheckStatusQuery = z.infer<typeof CheckStatusQuerySchema>;

// IF-CONSENT-GetAuditHistory: date range MUST be bounded/paginated per the
// spec's own G4 Performance Review correction (v0.1.1) -- no unbounded
// full-history scan, given the 5-year retention window (CRR §30).
export const GetAuditHistoryQuerySchema = z.object({
  worker_id: z.string().min(1),
  consent_instance: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type GetAuditHistoryQuery = z.infer<typeof GetAuditHistoryQuerySchema>;

// IF-CONSENT-CheckStatus's result shape: granted/declined/absent, not a
// thrown error for "no consent yet" (mirrors GeoService's GeofenceVerification
// discriminated-result pattern for the identical "not yet decided" case).
export type ConsentStatus =
  | { status: 'granted'; notice_version: string; decided_at: string }
  | { status: 'declined'; notice_version: string; decided_at: string }
  | { status: 'absent' };

// RULE-CONSENT-05: consent record DTO. No raw special-category data is ever
// carried here -- consent-acceptance metadata only (worker id, instance,
// version, decision, timestamp), consistent with the spec's own
// classification that consent records are not themselves special-category
// data (Data classification/retention section).
export interface ConsentRecordDto {
  id: string;
  worker_id: string;
  consent_instance: string;
  notice_version: string;
  decision: 'GRANTED' | 'DECLINED' | 'WITHDRAWN' | 'RENEWED';
  decided_at: string;
}
