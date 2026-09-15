import { describe, it, expect } from '@jest/globals';
import { matchL0 } from '../modules/chatbot/orchestrator/router-l0.js';

/**
 * The work-summary INTENT (2026-09-15).
 *
 * The owner's own sentence -- "give me record data previews weeks how much
 * work we did" -- routed in a full conversation but not on its own, across
 * several live runs. The meaning never changes and there is nothing to extract,
 * so it is answered deterministically. Most of what is pinned here is when the
 * intent must NOT fire: a named period or date, or a question about oneself.
 */
describe('"how much work did we do" is answered without the model', () => {
  it.each([
    'give me record data previews weeks how much work we did',
    'how much work did we do',
    'How much work have we done?',
    'how much work has the team done',
    'give me the work data for our hotels',
    'wie viel haben wir geschafft',
    'Wie viel Arbeit haben wir gemacht?',
  ])('matches: %s', (text) => {
    expect(matchL0(text)?.tool).toBe('reports.work_summary');
  });

  it('takes no arguments, so the tool\'s stated two-week default applies', () => {
    expect(matchL0('how much work did we do')?.args).toEqual({});
  });
});

describe('it steps aside when it cannot be sure', () => {
  it.each([
    // A period or a date is an argument this router cannot parse.
    'how much work did we do last week',
    'how much work did we do on 07.09.2026',
    'how much work did we do this month',
    'wie viel haben wir im August geschafft',
    'how much work did we do yesterday',
    // About oneself, not the team.
    'how much work did I do',
    // A different question that shares words.
    'how many rooms do we have today?',
    'what work do I have tomorrow',
  ])('does not match: %s', (text) => {
    expect(matchL0(text)?.tool).not.toBe('reports.work_summary');
  });
});
