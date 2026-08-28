import { resolveOutcomeAvailability } from '@/lib/inspection-outcome';

/**
 * The two outcomes a checker picks at the end of an inspection.
 *
 * The score deliberately does NOT appear here. An earlier revision gated
 * "assign rework" on the server's passing threshold, because `assignRework`
 * refused a PASSED verification -- which made the decision a function of the
 * number typed a moment earlier. Owner decision, 2026-08-29: rework is the
 * checker's call at any score. Both gates are gone, server and client.
 */
describe('inspection outcome availability', () => {
  it('allows rework at ANY score, given a comment', () => {
    // The regression this file exists for. `resolveOutcomeAvailability` takes
    // no score parameter at all, so this asserts the contract rather than a
    // range: a re-introduced gate could not be expressed without changing the
    // signature, and that would fail to compile here first.
    expect(resolveOutcomeAvailability('bathroom not done')).toEqual({
      reworkAllowed: true,
      reworkBlockedReason: null,
    });
  });

  it('blocks rework without a comment, because the comment IS the instructions', () => {
    // assignRework requires non-empty notes (z.string().min(1)) and sends them
    // to the worker as the push body. Whitespace would either be refused by
    // the server or deliver a blank instruction with a 20-minute clock on it.
    expect(resolveOutcomeAvailability('   ')).toEqual({
      reworkAllowed: false,
      reworkBlockedReason: 'NO_COMMENT',
    });
    expect(resolveOutcomeAvailability('').reworkAllowed).toBe(false);
  });

  it('never reports a blocked reason while also allowing rework', () => {
    // The screen renders the reason whenever it is present; a state that both
    // allows the action and explains why it cannot happen would put a
    // contradiction on screen.
    for (const comment of ['', ' ', 'note', 'a']) {
      const { reworkAllowed, reworkBlockedReason } = resolveOutcomeAvailability(comment);
      expect(reworkAllowed).toBe(reworkBlockedReason === null);
    }
  });
});
