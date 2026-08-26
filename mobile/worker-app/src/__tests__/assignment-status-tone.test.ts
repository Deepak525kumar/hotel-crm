import { ASSIGNMENT_STATUS_TONE, assignmentStatusTone } from '@/lib/assignment-status-tone';

describe('assignmentStatusTone', () => {
  // The distinction the whole map exists for.
  it('separates a finished shift from a cancelled one', () => {
    expect(assignmentStatusTone('COMPLETED')).toBe('success');
    expect(assignmentStatusTone('CANCELLED')).toBe('danger');
    expect(assignmentStatusTone('NO_SHOW')).toBe('danger');
  });

  // Green means finished; an in-progress shift must not borrow that meaning.
  it('does not colour in-progress as success', () => {
    expect(assignmentStatusTone('IN_PROGRESS')).not.toBe('success');
  });

  it('falls back to neutral for an unknown status', () => {
    expect(assignmentStatusTone('SOMETHING_NEW')).toBe('neutral');
  });

  it('covers every known status', () => {
    for (const tone of Object.values(ASSIGNMENT_STATUS_TONE)) {
      expect(tone).toBeTruthy();
    }
  });
});
