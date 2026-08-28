import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';

/**
 * A shift cannot be inspected before the worker starts it.
 *
 * Owner decision, 2026-08-29, after a checker recorded a completed inspection
 * against a shift still sitting in CONFIRMED — the worker had not begun, so
 * there was nothing in the room to look at, and the record said otherwise.
 *
 * The rule has to hold in FOUR places or it does not hold at all: the picker
 * that offers workers, and each of the three write paths. The web still uses
 * the two single-record endpoints, so guarding only the new combined one would
 * leave the hole open on the surface a manager actually uses.
 */
const src = () => readFileSync('src/modules/quality/service.ts', 'utf8');

function bodyOf(method: string): string {
  const s = src();
  const start = s.indexOf(`async ${method}(`);
  if (start === -1) throw new Error(`${method} not found`);
  // To the next top-level method declaration.
  const next = s.slice(start + 10).search(/\n  (private |public )?async \w+\(/);
  return s.slice(start, next === -1 ? undefined : start + 10 + next);
}

describe('the started-shift guard exists and is applied everywhere', () => {
  it('admits exactly IN_PROGRESS and COMPLETED', () => {
    const guard = bodyOf('') && src().slice(src().indexOf('private assertShiftHasStarted('));
    const head = guard.slice(0, guard.indexOf('throw new ValidationError'));
    expect(head).toContain('AssignmentStatus.IN_PROGRESS');
    expect(head).toContain('AssignmentStatus.COMPLETED');
    // CONFIRMED must NOT be in the admit list — it is the reported defect.
    expect(head).not.toContain('AssignmentStatus.CONFIRMED');
    // Nor the shared active-set constant, which contains CONFIRMED.
    expect(head).not.toContain('ACTIVE_ASSIGNMENT_STATUSES');
  });

  it.each(['recordInspection', 'createVerification', 'createRating'])(
    '%s calls it',
    (method) => {
      expect(bodyOf(method)).toContain('this.assertShiftHasStarted(assignment)');
    }
  );

  it('the picker stops offering shifts that would be refused', () => {
    // Offering a CONFIRMED shift and then rejecting it at submit time would
    // waste the entire form — checklist, photos and all. The picker and the
    // guard must agree.
    const body = bodyOf('listInspectableWorkers');
    expect(body).toContain(
      'status: { in: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED] }'
    );
    expect(body).not.toContain('...ACTIVE_ASSIGNMENT_STATUSES, AssignmentStatus.COMPLETED');
  });

  it('runs AFTER authorization, not before', () => {
    // An actor who may not inspect this assignment must get that answer, not a
    // hint about the shift's state. Same posture the photo rule already takes.
    const body = bodyOf('recordInspection');
    expect(body.indexOf('assertCanInspect')).toBeLessThan(
      body.indexOf('this.assertShiftHasStarted')
    );
  });

  it('runs BEFORE the photo upload, so a refusal leaves no orphaned objects', () => {
    const body = bodyOf('recordInspection');
    expect(body.indexOf('this.assertShiftHasStarted')).toBeLessThan(
      body.indexOf('this.uploadPhotos(')
    );
  });

  it('records that it supersedes ADR-072 §2.5 rather than silently contradicting it', () => {
    // That ADR explicitly decided check-in state would NOT filter the list.
    // A reader who finds this code and then that ADR must be told which wins,
    // or the next change reinstates the defect on the ADR's authority.
    const guard = src().slice(src().indexOf('private assertShiftHasStarted('));
    const doc = src().slice(0, src().indexOf('private assertShiftHasStarted('));
    expect(doc.slice(-2000) + guard.slice(0, 200)).toMatch(/ADR-072/);
    expect(doc.slice(-2000)).toMatch(/supersede/i);
  });
});
