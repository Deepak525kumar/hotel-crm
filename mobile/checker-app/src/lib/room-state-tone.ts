import type { RoomState } from '@/types/api';
import type { BadgeTone } from '@/components/ui';

/**
 * One room-state -> colour mapping for the whole app, for the same reason
 * `assignment-status-tone.ts` exists: two screens with their own copy drifted
 * and showed the same shift in two colours.
 *
 * AWAITING_CHECK is neutral rather than warning: it is the normal state of
 * nearly every row in the picker, and a list of amber badges tells the checker
 * nothing. REWORK_SUBMITTED is primary, not success — the room auto-passed on
 * the worker's word and the photos have not been looked at yet, which is
 * exactly the distinction the "Reworked" group exists to make.
 */
export const ROOM_STATE_TONE: Record<RoomState, BadgeTone> = {
  AWAITING_CHECK: 'neutral',
  PASSED: 'success',
  NEEDS_REWORK: 'warning',
  REWORK_SUBMITTED: 'primary',
};

/** Falls back to neutral for a state this build does not know about. */
export function roomStateTone(state: string): BadgeTone {
  return ROOM_STATE_TONE[state as RoomState] ?? 'neutral';
}
