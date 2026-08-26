import { greetingKeyForHour, workerDisplayName } from '@/lib/greeting';

describe('workerDisplayName', () => {
  it('returns a real name', () => {
    expect(workerDisplayName('Maria')).toBe('Maria');
    expect(workerDisplayName('  Ana-Lucia  ')).toBe('Ana-Lucia');
  });

  it.each([null, undefined, '', '   '])('returns null for %p', (input) => {
    expect(workerDisplayName(input)).toBeNull();
  });

  it.each(['Worker', 'worker', 'WORKER', 'Admin', 'Test', 'unknown'])(
    'refuses the placeholder %s, so the app never says "Hi, Worker"',
    (input) => {
      expect(workerDisplayName(input)).toBeNull();
    },
  );

  it('refuses something that looks like a cuid rather than a name', () => {
    // A checker once saw the tail of a cuid where a worker's name belonged.
    expect(workerDisplayName('cmt97env5003c')).toBeNull();
  });

  it('keeps a legitimate name that merely happens to be long', () => {
    expect(workerDisplayName('Konstantinos')).toBe('Konstantinos');
  });
});

describe('greetingKeyForHour', () => {
  it.each([
    [0, 'home.greetingMorning'],
    [8, 'home.greetingMorning'],
    [11, 'home.greetingMorning'],
    [12, 'home.greetingAfternoon'],
    [17, 'home.greetingAfternoon'],
    [18, 'home.greetingEvening'],
    [23, 'home.greetingEvening'],
  ])('maps hour %i to %s', (hour, key) => {
    expect(greetingKeyForHour(hour as number)).toBe(key);
  });
});
