import { describe, it, expect } from '@jest/globals';
import { CreateUserSchema } from '../modules/users/types.js';

/**
 * `skills` on POST /users, at the schema boundary.
 *
 * Two reasons this is worth its own suite rather than a service test:
 *
 *  1. The field is the fix for a SILENT loss. The create form has offered
 *     skill checkboxes since it was built, this schema had no field for them,
 *     and Zod strips unknown keys -- so every worker created through the UI
 *     was stored with none, with nothing anywhere reporting a problem. A test
 *     that only checks the happy path would not have caught the original bug
 *     either; what catches it is asserting the value SURVIVES parsing.
 *  2. The transport is multipart (the mandatory photo), which has no array
 *     type. The array therefore arrives as a JSON string and is parsed here.
 *     That parsing is new logic with several ways to be handed something
 *     unexpected, and none of it is visible to tsc.
 */

const base = {
  email: 'w@test.com',
  password: 'pw12345678',
  first_name: 'W',
  last_name: 'K',
  phone: '+1234567890',
  role: 'worker' as const,
};

function parse(over: Record<string, unknown>) {
  return CreateUserSchema.safeParse({ ...base, ...over });
}

describe('CreateUserSchema.skills', () => {
  it('accepts a JSON string, which is how multipart carries the array', () => {
    const result = parse({ skills: JSON.stringify(['CLEANER', 'WAITER']) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skills).toEqual(['CLEANER', 'WAITER']);
  });

  it('accepts a real array, which is how a JSON client or repeated field arrives', () => {
    const result = parse({ skills: ['CLEANER'] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skills).toEqual(['CLEANER']);
  });

  // The field is optional (owner decision): skills can be set later from the
  // profile, so an account with none must still be creatable.
  it('is optional', () => {
    const result = parse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skills).toBeUndefined();
  });

  // An untouched multipart text field arrives as "" rather than being absent.
  // Treating that as [] would write an empty array where the caller meant
  // "not specified".
  it('treats an empty string as absent, not as an empty list', () => {
    const result = parse({ skills: '' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skills).toBeUndefined();
  });

  it('accepts an explicitly empty list', () => {
    const result = parse({ skills: JSON.stringify([]) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skills).toEqual([]);
  });

  // De-duplicated at the boundary: assertValidSkills checks each tag but does
  // not dedupe, and EmploymentRecord.skills is a plain array, so a duplicate
  // from any non-form client would be stored twice.
  it('de-duplicates repeated tags', () => {
    const result = parse({ skills: JSON.stringify(['CLEANER', 'CLEANER', 'WAITER']) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.skills).toEqual(['CLEANER', 'WAITER']);
  });

  it('rejects an unrecognized tag rather than dropping it', () => {
    const result = parse({ skills: JSON.stringify(['CLEANER', 'ASTRONAUT']) });
    expect(result.success).toBe(false);
  });

  // Malformed JSON must fail loudly. The preprocess deliberately passes the
  // raw string through on a parse error so the array check reports it --
  // silently discarding it is the original bug's failure mode.
  it('rejects malformed JSON instead of silently discarding it', () => {
    const result = parse({ skills: '[CLEANER' });
    expect(result.success).toBe(false);
  });

  it('rejects JSON that is not an array', () => {
    expect(parse({ skills: JSON.stringify('CLEANER') }).success).toBe(false);
    expect(parse({ skills: JSON.stringify({ tag: 'CLEANER' }) }).success).toBe(false);
    expect(parse({ skills: JSON.stringify(7) }).success).toBe(false);
  });

  it('rejects a nested array', () => {
    expect(parse({ skills: JSON.stringify([['CLEANER']]) }).success).toBe(false);
  });
});
