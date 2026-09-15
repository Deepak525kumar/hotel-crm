import { z } from 'zod';

/**
 * Phone numbers as people write them, stored as E.164.
 *
 * REPORTED 2026-09-15. An admin filling in the New user form for a worker
 * typed `016090744182` -- a German mobile number, written exactly the way it
 * is printed on every contract, business card and SIM packet in this country
 * -- and got back "Request body validation failed", with nothing on screen
 * saying which field. The E.164 regex below requires the first digit to be
 * 1-9, and a national-format German number always starts with the trunk
 * prefix 0. Every German number typed the natural way was refused.
 *
 * WHY NORMALISE RATHER THAN LOOSEN THE REGEX. The 2026-08-08 security review
 * that introduced the regex listed `0123456789` as INVALID on purpose, and it
 * was right to: a store that accepts both `0160...` and `+49160...` holds two
 * spellings of one number, so the unique index on User.phone stops meaning
 * "one account per number". Converting the national form to E.164 at the
 * boundary keeps exactly one spelling in the database and accepts what
 * people actually type.
 *
 * WHY +49. This platform's workforce and hotels are in Germany
 * (`CALENDAR_TIMEZONE` is Europe/Berlin for the same reason). A number
 * written with a single leading 0 carries no country, so a default is
 * unavoidable; anyone abroad writes the + or 00 form, which is kept as given.
 */
const E164 = /^\+?[1-9]\d{1,14}$/;

const DEFAULT_COUNTRY_CODE = '49';

export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  // Separators people type between digit groups: "0160 / 907 441-82",
  // "+49 (0) 160 ...". A blank stays blank so the schema reports it as it
  // always has, rather than as a malformed number.
  const compact = value.trim().replace(/[\s\-./()]/g, '');
  if (compact === '') return value.trim();

  // "00" is the international dialling prefix and means "+".
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;

  // "+49 (0) 160" -- the parenthesised trunk zero is written by habit and is
  // never dialled after the country code.
  if (compact.startsWith(`+${DEFAULT_COUNTRY_CODE}0`)) {
    return `+${DEFAULT_COUNTRY_CODE}${compact.slice(DEFAULT_COUNTRY_CODE.length + 2)}`;
  }

  // National format: exactly one trunk zero, then a real digit.
  if (/^0[1-9]/.test(compact)) return `+${DEFAULT_COUNTRY_CODE}${compact.slice(1)}`;

  return compact;
}

/** A phone field: normalised first, then held to E.164. */
export const phoneNumber = z.preprocess(
  normalizePhone,
  z.string().regex(E164, 'Invalid phone number')
);
