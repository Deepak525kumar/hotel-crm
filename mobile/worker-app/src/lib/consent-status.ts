import type { ConsentStatus } from '@/types/api';

export function statusLabel(status: ConsentStatus): string {
  switch (status.status) {
    case 'granted':
      return 'Granted';
    case 'declined':
      return 'Declined';
    case 'absent':
      return 'Not yet decided';
  }
}

export function statusColor(status: ConsentStatus): string {
  switch (status.status) {
    case 'granted':
      return '#38A169';
    case 'declined':
      return '#E53E3E';
    case 'absent':
      return '#DD6B20';
  }
}

export function statusDescription(status: ConsentStatus): string | null {
  switch (status.status) {
    case 'granted':
      return `Decided ${new Date(status.decided_at).toLocaleString()} · notice ${status.notice_version}`;
    case 'declined':
      return `You previously declined this notice on ${new Date(status.decided_at).toLocaleString()}. You can review it again below.`;
    case 'absent':
      return null;
  }
}

// The one action valid for the current status — never both Review and
// Withdraw at once, never Grant/Decline shown before a notice is fetched.
// Extracted as a pure function (not inlined in JSX) so the status -> action
// mapping is directly testable without a component-rendering library.
export type ConsentAction = 'review' | 'review-again' | 'withdraw';

export function statusAction(status: ConsentStatus): ConsentAction {
  switch (status.status) {
    case 'granted':
      return 'withdraw';
    case 'declined':
      return 'review-again';
    case 'absent':
      return 'review';
  }
}
