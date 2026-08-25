import type { CalendarAbsenceKind } from '@/types/api';

/**
 * The backend's rule for absence reasons, mirrored client-side.
 *
 * MarkAbsenceSchema (backend/src/modules/calendar/types.ts) requires a reason
 * for VACATION and leaves it optional for SICK. The apps offered both kinds as
 * one-tap buttons and never sent a reason at all, so every vacation request was
 * rejected:
 *
 *   POST /calendar/my-absences {day, kind: "VACATION"} -> 422 "reason is required for a VACATION absence"
 *   POST /calendar/my-absences {day, kind: "SICK"}     -> 200
 *
 * SICK is deliberately NOT required to carry a reason, and the UI must not ask
 * for one: the backend comment is explicit that forcing it would incentivise
 * disclosing health details (GDPR special-category data) on what this model
 * keeps as a plain flag. Validating here rather than only server-side means the
 * worker gets the message before the round-trip, and in their own language.
 */
export const ABSENCE_REASON_MAX_LENGTH = 500;

export type AbsenceReasonError = 'required' | 'tooLong' | null;

export function validateAbsenceReason(
  kind: CalendarAbsenceKind,
  reason: string | undefined
): AbsenceReasonError {
  const trimmed = (reason ?? '').trim();
  if (kind === 'VACATION' && trimmed.length === 0) return 'required';
  if (trimmed.length > ABSENCE_REASON_MAX_LENGTH) return 'tooLong';
  return null;
}

/**
 * What to actually send. An empty reason is omitted rather than sent as "",
 * which the backend's `.min(1)` would reject even for SICK.
 */
export function normalizeAbsenceReason(reason: string | undefined): string | undefined {
  const trimmed = (reason ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
