import { afterAll, expect } from '@jest/globals';

/**
 * CROSS-FILE POLLUTION, MADE TO NAME ITSELF.
 *
 * The suite runs `--runInBand`: one process, every file in sequence. Jest
 * resets the module registry between files but it does NOT reset PROCESS
 * GLOBALS, so anything a suite assigns to `Intl`, `global.fetch`, `Date` or
 * `Math.random` stays assigned for every file that runs afterwards.
 *
 * That is not theoretical here. Two real instances existed on 2026-09-10:
 *
 *   - `chatbot-mantle-provider.test.ts` installed a `global.fetch` mock and
 *     never restored it, so every later suite that called fetch without
 *     mocking got a mantle-shaped response to a question it never asked.
 *   - `calendar-absence.test.ts` stubbed `Intl.DateTimeFormat` with a
 *     function that ignores locale and options and returns one frozen date
 *     string, restoring it by reassignment rather than `mockRestore()`. A
 *     miss there does not degrade a later suite; it silently freezes every
 *     date in it -- and the chatbot's system prompt, `todayIso()` and its
 *     whole precomputed calendar are built on `Intl.DateTimeFormat`.
 *
 * Both are fixed. This exists because the NEXT one will not be, and because
 * of how it presents when it happens: some unrelated suite fails
 * intermittently, passes when run alone, and passes on re-run. Two suites
 * behaved exactly like that and cost hours to chase without ever
 * reproducing. The failure appears wherever the damage lands, never where it
 * was caused.
 *
 * So this runs after every test FILE and fails the file that actually did it,
 * with its own name in the message. A flake becomes a deterministic failure
 * pointing at the culprit.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: restore anything. Silently repairing the
 * global would hide the bug and leave the ordering-dependent behaviour in
 * place for whoever runs a subset of files. The point is to make it loud.
 */

const PRISTINE = {
  DateTimeFormat: Intl.DateTimeFormat,
  NumberFormat: Intl.NumberFormat,
  fetch: globalThis.fetch,
  Date: globalThis.Date,
  random: Math.random,
};

/**
 * NOT CHECKED: `process.env`.
 *
 * It was, briefly, and it failed eight unrelated suites on the first run --
 * setting an environment variable in a test is ordinary and almost always
 * harmless, because `loadEnv()` is re-read per file anyway. A guard that
 * cries wolf is worse than no guard: it trains everyone to skim past its
 * message, and the one time it is right nobody reads it. The five entries
 * above are function-valued globals whose replacement is never incidental.
 */

afterAll(() => {
  const leaked: string[] = [];

  if (Intl.DateTimeFormat !== PRISTINE.DateTimeFormat) leaked.push('Intl.DateTimeFormat');
  if (Intl.NumberFormat !== PRISTINE.NumberFormat) leaked.push('Intl.NumberFormat');
  if (globalThis.fetch !== PRISTINE.fetch) leaked.push('globalThis.fetch');
  if (globalThis.Date !== PRISTINE.Date) leaked.push('globalThis.Date');
  if (Math.random !== PRISTINE.random) leaked.push('Math.random');

  expect({
    leakedGlobals: leaked,
    hint:
      leaked.length === 0
        ? undefined
        : 'This test FILE left a process global replaced. The suite runs in one ' +
          'process, so every file after this one inherits it -- which shows up as ' +
          'an unrelated suite failing intermittently and passing when run alone. ' +
          'Restore it in an afterEach/afterAll (prefer spy.mockRestore() over ' +
          'reassigning the property).',
  }).toEqual({ leakedGlobals: [], hint: undefined });
});
