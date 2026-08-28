import { readFileSync } from 'fs';
import { join } from 'path';

import {
  PASSING_SCORE,
  resolveOutcomeAvailability,
} from '@/lib/inspection-outcome';

/**
 * The two outcomes a checker picks at the end of an inspection, and the one
 * rule that constrains them.
 *
 * `assignRework` refuses a PASSED verification, and PASSED is derived
 * server-side from the score — so "assign rework" above the threshold is a
 * button whose only possible result is a 400, after the checker has filled in
 * the whole form.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

describe('inspection outcome availability', () => {
  it('allows rework below the passing score, with a comment', () => {
    expect(resolveOutcomeAvailability(45, 'bathroom not done')).toEqual({
      reworkAllowed: true,
      reworkBlockedReason: null,
    });
  });

  it('blocks rework at and above the passing score', () => {
    // The boundary itself passes: the server's rule is `>= 70 -> PASSED`.
    expect(resolveOutcomeAvailability(PASSING_SCORE, 'anything')).toEqual({
      reworkAllowed: false,
      reworkBlockedReason: 'PASSING_SCORE',
    });
    expect(resolveOutcomeAvailability(PASSING_SCORE - 1, 'anything').reworkAllowed).toBe(true);
  });

  it('blocks rework without a comment, because the comment IS the instructions', () => {
    // assignRework requires non-empty notes (z.string().min(1)) and sends them
    // to the worker as the push body. Submitting whitespace would either be
    // refused by the server or deliver a blank instruction.
    expect(resolveOutcomeAvailability(45, '   ')).toEqual({
      reworkAllowed: false,
      reworkBlockedReason: 'NO_COMMENT',
    });
  });

  it('blocks rework when there is no usable score yet', () => {
    for (const bad of [null, NaN, -1, 101, 45.5]) {
      expect(resolveOutcomeAvailability(bad as number | null, 'note')).toEqual({
        reworkAllowed: false,
        reworkBlockedReason: 'NO_SCORE',
      });
    }
  });

  it('never reports a blocked reason while also allowing rework', () => {
    // The screen renders the reason whenever it is present; a state that both
    // allows the action and explains why it cannot happen would put a
    // contradiction on screen.
    for (const score of [0, 39, 40, 69, 70, 100]) {
      for (const comment of ['', 'note']) {
        const { reworkAllowed, reworkBlockedReason } = resolveOutcomeAvailability(score, comment);
        expect(reworkAllowed).toBe(reworkBlockedReason === null);
      }
    }
  });
});

describe('passing-score client/server parity', () => {
  it('PASSING_SCORE equals the threshold createVerification derives PASSED from', () => {
    // Read from the server source, not restated. A drifted constant here is
    // invisible until a checker taps a button the server then refuses — the
    // same failure mode the checklist keys already carry a guard for.
    const src = readFileSync(
      join(REPO_ROOT, 'backend', 'src', 'modules', 'quality', 'service.ts'),
      'utf8',
    );
    const match = /numScore >= (\d+)\s*\n?\s*\?\s*VerificationStatus\.PASSED/.exec(src);
    if (!match) throw new Error('PASSED threshold not found in the backend service');
    expect(PASSING_SCORE).toBe(Number(match[1]));
  });
});
