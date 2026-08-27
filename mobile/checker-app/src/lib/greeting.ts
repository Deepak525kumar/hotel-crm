/**
 * Home-screen greeting.
 *
 * The dashboard used to render `Hi, {user.first_name} 👋` unconditionally,
 * which produced "Hi, Worker 👋" for any account whose first name is a
 * placeholder, and a bare "Hi,  👋" when the field was empty. Both read as
 * unfinished software. The name is now separated from the salutation, the
 * salutation follows the clock, and a missing or placeholder name falls back to
 * a greeting that stands on its own.
 */

/** Names that are obviously not a person's name and must not be greeted. */
const PLACEHOLDER_NAMES = new Set([
  'worker',
  'checker',
  'manager',
  'admin',
  'user',
  'test',
  'testuser',
  'firstname',
  'n/a',
  'na',
  'unknown',
  'null',
  'undefined',
]);

/**
 * The name to greet, or null when there is nothing worth greeting.
 *
 * Also rejects a value that looks like an id rather than a name: onboarding
 * screens in this app have shipped the tail of a cuid where a name belonged
 * before (see the 2026-08-25 mobile flow verification), and greeting someone
 * as "cmt97env5" is worse than not greeting them at all.
 */
export function workerDisplayName(firstName: string | null | undefined): string | null {
  const name = (firstName ?? '').trim();
  if (!name) return null;
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return null;
  // A cuid tail: long, no separators, and mixing digits into lowercase text.
  if (/^[a-z0-9]{8,}$/.test(name) && /\d/.test(name)) return null;
  return name;
}

/** i18n key for the salutation appropriate to `hour` (0-23, local time). */
export function greetingKeyForHour(hour: number): string {
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}
