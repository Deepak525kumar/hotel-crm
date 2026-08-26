import type { AssignmentStatus } from '@/types/api';
import type { BadgeTone } from '@/components/ui';

/**
 * One status -> colour mapping for the whole app.
 *
 * The dashboard and the schedule kept separate copies and drifted: the same
 * shift showed green on one screen and blue on the other.
 *
 * The three terminal states carry the outcome, so they are the ones that must
 * read at a glance: work done is green, work missed or called off is red.
 * COMPLETED and CANCELLED were both neutral, which made a finished shift and a
 * cancelled one look identical in a list. IN_PROGRESS is deliberately NOT green
 * -- green means finished here.
 */
export const ASSIGNMENT_STATUS_TONE: Record<AssignmentStatus, BadgeTone> = {
  CONFIRMED: 'primary',
  IN_PROGRESS: 'primary',
  COMPLETED: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'danger',
  REASSIGNED: 'warning',
};

/** Falls back to neutral for a status this build does not know about. */
export function assignmentStatusTone(status: string): BadgeTone {
  return ASSIGNMENT_STATUS_TONE[status as AssignmentStatus] ?? 'neutral';
}
