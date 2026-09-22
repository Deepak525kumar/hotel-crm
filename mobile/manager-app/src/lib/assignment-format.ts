import type { BadgeTone } from '@hotel-crm/mobile-shared';

/** Assignment status colour. CANCELLED and NO_SHOW are not the same fact. */
export function assignmentTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'IN_PROGRESS':
      return 'primary';
    case 'NO_SHOW':
      return 'danger';
    case 'CANCELLED':
      return 'warning';
    default:
      return 'neutral';
  }
}
