import { EmploymentStatus, SkillTag } from '@prisma/client';
import { ValidationError } from '../../lib/errors.js';

// REQ-EMP-003 / RULE-EMP-04: each fixed skill tag's assessment basis.
export const ASSESSMENT_BASIS: Record<SkillTag, string> = {
  [SkillTag.CLEANER]: 'rooms_cleaned',
  [SkillTag.PUBLIC_SERVICE]: 'hours_worked',
  [SkillTag.KITCHEN_DISHWASHER]: 'hours_worked',
  [SkillTag.WAITER]: 'hours_worked',
};

// REQ-EMP-002 rework (2026-08-06): permanent, non-terminal lifecycle.
// Supersedes the old terminal-state table (RULE-EMP-02/03/12) -- every state
// can return to ACTIVE, so rehire never requires a duplicate User
// (RULE-EMP-01). No Suspended state; no rating/warning-driven automatic
// transition out of Active (MODULE_SPEC.md "State and Lifecycle" invariants
// -- still true, unaffected by this rework).
//
// DEACTIVATED means a temporary pause only (leave/seasonal/suspension) and
// always reactivates directly. DELETED means the person left the company and
// its return is a true rehire, gated through PENDING (re-approval required) —
// see EmployeeManagementService.applyTransition's DEACTIVATED/DELETED
// reason-requirement enforcement for the other half of this distinction.
export const ALLOWED_TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
  [EmploymentStatus.PENDING]: [EmploymentStatus.ACTIVE, EmploymentStatus.REJECTED],
  [EmploymentStatus.ACTIVE]: [EmploymentStatus.DEACTIVATED, EmploymentStatus.DELETED],
  [EmploymentStatus.DEACTIVATED]: [EmploymentStatus.ACTIVE, EmploymentStatus.DELETED],
  [EmploymentStatus.REJECTED]: [EmploymentStatus.ACTIVE, EmploymentStatus.DELETED],
  [EmploymentStatus.DELETED]: [EmploymentStatus.PENDING],
};

export function assertTransition(from: EmploymentStatus, to: EmploymentStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ValidationError(`Illegal employment status transition: ${from} -> ${to}`, [
      { field: 'status', message: `Cannot transition from ${from} to ${to}` },
    ]);
  }
}

// REQ-EMP-008 / RULE-EMP-11: provisional field -> retention-tier classification.
// Tier 1 (6 months): shift/attendance-linked coordinates.
// Tier 2 (5 years): general personal/profile data.
// Tier 3 (6 years): payroll/tax-adjacent fields.
// Provisional pending a confirmed field catalog (spec Data classification/
// retention section names the tiers but not every field's placement).
export type RetentionTier = 'TIER1_6MONTHS' | 'TIER2_5YEARS' | 'TIER3_6YEARS';

export const RETENTION_TIERS: Record<string, RetentionTier> = {
  // Tier 1 — shift/attendance coordinates
  shift_coordinates: 'TIER1_6MONTHS',
  attendance_coordinates: 'TIER1_6MONTHS',
  // Tier 2 — general personal/profile data
  job_title: 'TIER2_5YEARS',
  personal_data: 'TIER2_5YEARS',
  konfession: 'TIER2_5YEARS',
  disability_status: 'TIER2_5YEARS',
  skills: 'TIER2_5YEARS',
  start_date: 'TIER2_5YEARS',
  // Tier 3 — payroll/tax-adjacent
  iban: 'TIER3_6YEARS',
  tax_id: 'TIER3_6YEARS',
  payslip_records: 'TIER3_6YEARS',
  wage_records: 'TIER3_6YEARS',
};

export function getRetentionTiers(): Record<string, RetentionTier> {
  return RETENTION_TIERS;
}

// PROVISIONAL (OD-EMP-16 / PERF-EMP-002): MODULE_SPEC.md records no confirmed
// performance budget for any IF-EMP-* interface (OD-EMP-16, G4 PERF-EMP-001
// High) and flags REQ-EMP-004's profile-and-history aggregation specifically
// as needing a result-set/date-range bound and a maximum synchronous fan-out
// cap (G4 PERF-EMP-002, Medium) to avoid unbounded fan-out risk. These figures
// are conservative placeholders pending a real workload-derived budget; they
// are not sourced from any confirmed requirement.
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_HISTORY_MONTHS = 24;
export const DEFAULT_HISTORY_MONTHS = 12;
// Cap on the number of referenced-data sources fanned out to synchronously
// per profile-and-history request (e.g. attendance, ratings, ...).
export const MAX_HISTORY_SOURCES = 5;
