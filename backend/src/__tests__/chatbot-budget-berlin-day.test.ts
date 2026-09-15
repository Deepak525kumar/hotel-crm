import { describe, it, expect } from '@jest/globals';
import { startOfBerlinDay } from '../modules/chatbot/guardrails/budget.js';
import { renderBudgetFallback, renderIncompleteRequest } from '../modules/chatbot/orchestrator/templates.js';

/**
 * "FULL USE COMES BACK TOMORROW" -- on a German clock.
 *
 * The daily cap summed spend since midnight UTC, which is 01:00 or 02:00 in
 * Berlin. A manager capped at 23:30 kept waiting past their own midnight, and
 * spend at 00:30 was charged to the day before. Both daylight-saving states are
 * pinned, because a fix that is right in summer and wrong in winter passes any
 * test run in only one of them.
 */
describe('startOfBerlinDay', () => {
  it.each([
    ['00:30 Berlin in summer belongs to the new day', '2026-09-15T22:30:00Z', '2026-09-15T22:00:00.000Z'],
    ['23:30 Berlin in summer still belongs to the old day', '2026-09-15T21:30:00Z', '2026-09-14T22:00:00.000Z'],
    ['00:30 Berlin in winter belongs to the new day', '2026-01-15T23:30:00Z', '2026-01-15T23:00:00.000Z'],
    ['midday in winter', '2026-01-15T11:00:00Z', '2026-01-14T23:00:00.000Z'],
  ])('%s', (_label, now, expected) => {
    expect(startOfBerlinDay(new Date(now)).toISOString()).toBe(expected);
  });

  it('is stable on the day the clocks go back', () => {
    // 2026-10-25: 03:00 CEST becomes 02:00 CET. Midnight that day was still CEST.
    expect(startOfBerlinDay(new Date('2026-10-25T12:00:00Z')).toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });
});

describe('a confirmation lists a plan as lines, not JSON', () => {
  it('shows every value of every entry, without braces or internal keys', async () => {
    const { renderConfirmationRequest } = await import('../modules/chatbot/orchestrator/templates.js');
    const text = renderConfirmationRequest('calendar.apply_plan', {
      hotel_name: 'Hotel Adler',
      absences: [{ worker_name: 'Anna Braun', day: '2026-09-21', kind: 'SICK' }],
      placements: [{ worker_name: 'Tomasz Nowak', day: '2026-09-21' }],
    });
    expect(text).toBe(
      [
        'Apply this plan to the calendar:',
        '  Hotel: Hotel Adler',
        '  Away:',
        '    - Anna Braun, 2026-09-21, sick',
        '  Shifts:',
        '    - Tomasz Nowak, 2026-09-21',
        '',
        'Nothing has been changed yet. Confirm to go ahead, or cancel.',
      ].join('\n')
    );
  });
});

describe('the messages a capped or incomplete turn produces', () => {
  it('never exposes the cap\'s value', () => {
    expect(renderBudgetFallback('daily-user-cap-exhausted')).not.toMatch(/\d/);
  });

  it('names what a write still needs, in the confirmation screen\'s own words', () => {
    const text = renderIncompleteRequest('assignments.cancel_shift', ['day', 'day']);
    expect(text).toBe(
      'I understood that you want to cancel a shift, but I still need: day. Dates can be written like "16 September" or "tomorrow".'
    );
  });
});
