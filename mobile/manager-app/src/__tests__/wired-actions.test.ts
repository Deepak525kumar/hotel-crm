import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

/**
 * Buttons that must actually do something.
 *
 * `route-targets-exist.test.ts` catches a link to a screen that does not
 * exist. It cannot catch a button whose handler runs and changes nothing —
 * which is a worse failure, because the app looks like it worked.
 *
 * Both cases below were found on a real device on 2026-09-23, after every
 * suite was green:
 *
 *  - The rota's "move" button was `onMove={() => setOpenShift(null)}`. It
 *    closed the sheet and wrote nothing. The endpoint and the client method
 *    had both existed since the calendar was rebuilt; only the call was
 *    missing, and the owner reported being unable to move a shift at all.
 *  - The new-team-member form never collected a profile photo, which
 *    `POST /users` requires before Zod even runs, so every submission failed
 *    with a generic validation message.
 *
 * These are source-shape assertions, which are weak — they prove a call is
 * present, not that it is correct. They exist because the alternative here is
 * nothing at all: neither defect is reachable from a unit test without a
 * rendered screen, and both shipped past a full green suite.
 */
describe('actions are wired to a write', () => {
  it('moving a shift calls the move endpoint', () => {
    const calendar = read('app', '(app)', 'calendar.tsx');
    expect(calendar).toContain('moveCalendarEntry');
    // The handler must take the chosen day, not ignore it.
    expect(calendar).toMatch(/onMove=\{\s*\(day\)/);
    // And must refresh, or the moved shift stays under its old heading.
    expect(calendar).toContain('placements.mutate()');
  });

  it('the shift sheet collects a day rather than firing blind', () => {
    const sheet = read('components', 'ShiftSheet.tsx');
    expect(sheet).toContain('onMove: (day: string) => void');
    // Moving to the day it is already on writes nothing; the server accepts
    // it and the UI reads as a silent failure.
    expect(sheet).toMatch(/targetDay === entry\.day/);
  });

  it('creating a team member sends the mandatory photo', () => {
    const form = read('app', 'team', 'new.tsx');
    // The picker exists...
    expect(form).toContain('launchCameraAsync');
    expect(form).toContain('launchImageLibraryAsync');
    // ...the photo is sent...
    expect(form).toMatch(/\.\.\.\(photo \? \{ photo \} : \{\}\)/);
    // ...and submit is blocked until there is one, because the endpoint
    // rejects the request outright without it.
    expect(form).toMatch(/photo !== null &&/);
  });
});
