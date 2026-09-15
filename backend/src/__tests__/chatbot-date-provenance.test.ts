import { describe, it, expect } from '@jest/globals';
import { collectDates, unsupportedDates } from '../modules/chatbot/orchestrator/date-provenance.js';

/**
 * Dates in a proposed change must come from the person, not the model.
 *
 * Found by replaying the owner's conversation verbatim (2026-09-15): after
 * "add that another dates also" the model proposed 20, 21 and 22 September,
 * days nobody had mentioned.
 */
describe('unsupportedDates', () => {
  const plan = (...days: string[]) => ({ placements: days.map((day) => ({ worker_name: 'Parveen Kumar', day })) });

  it('flags invented dates: the verbatim case', () => {
    const texts = ['make me plans. for parveen 17 18 19 September', 'ok make', 'add that another dates also'];
    expect(unsupportedDates(plan('2026-09-20', '2026-09-21', '2026-09-22'), texts)).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ]);
  });

  it.each([
    [['make me plans. for parveen 17 18 19 September'], plan('2026-09-17', '2026-09-18', '2026-09-19')],
    [['cancel shift for parveen kumar 16 September'], { worker_name: 'Parveen', day: '2026-09-16' }],
    [['15 16 17 what dates', 'harvir singh'], plan('2026-09-15', '2026-09-16', '2026-09-17')],
    [['17 add'], { worker_name: 'Parveen', day: '2026-09-17' }],
    [['put Anna on 2026-09-21'], { worker_name: 'Anna', day: '2026-09-21' }],
    [['07.09.2026 data'], { from: '2026-09-07', to: '2026-09-07' }],
  ])('accepts dates the person typed: %j', (texts, args) => {
    expect(unsupportedDates(args, texts)).toEqual([]);
  });

  it.each([
    'put Anna on tomorrow',
    'Anna is off sick Monday, put Tomasz on Monday and Tuesday',
    'schedule Tomasz for next week',
    'Parveen hat heute 10 Zimmer gemacht',
    'Anna übernimmt Tomaszs Schicht am Freitag',
  ])('accepts relative and weekday wording it cannot pin to a number: %s', (text) => {
    expect(unsupportedDates(plan('2026-09-21', '2026-09-22'), [text])).toEqual([]);
  });

  it('flags a date when the person named none at all', () => {
    expect(unsupportedDates({ worker_name: 'Parveen', day: '2026-09-16' }, ['cancel shift for parveen kumar'])).toEqual(['2026-09-16']);
  });

  it('ignores arguments with no dates', () => {
    expect(unsupportedDates({ worker_name: 'Parveen', rooms: 10 }, ['parveen did 10 rooms'])).toEqual([]);
  });

  it('finds dates nested anywhere', () => {
    expect(collectDates({ a: [{ day: '2026-09-20' }], b: { to: '2026-09-21' }, c: 'not-a-date' })).toEqual(['2026-09-20', '2026-09-21']);
  });
});
