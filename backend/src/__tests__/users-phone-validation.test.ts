import { describe, it, expect } from '@jest/globals';
import {
  CreateUserSchema,
  UpdateUserSchema,
  UpdateUserProfileSchema,
} from '../modules/users/types.js';

/**
 * Phone format regression (security review, 2026-08-08): `phone` was a bare
 * `z.string()` on all three of these schemas, unlike auth/validation.ts's
 * RegisterSchema/... which already enforce the same E.164 regex. Any string
 * (empty, non-numeric, arbitrary length) passed schema validation and only
 * failed, if at all, downstream at the database/UI layer.
 */
describe('users/types.ts — phone E.164 validation', () => {
  const VALID = ['+14155552671', '447911123456', '+919876543210'];
  // `0123456789` was on this list until 2026-09-15. It is a national-format
  // German number, and refusing it refused every German number typed the way
  // it is written -- an admin creating a worker with `016090744182` got
  // "Request body validation failed". It is now CONVERTED to E.164 rather
  // than rejected; see the normalisation cases below and lib/phone.ts.
  const INVALID = ['not-a-phone', '+', 'abc123', '++14155552671', '00', '0'];

  describe('CreateUserSchema', () => {
    // ADR-065 (Universal Onboarding Gate): role defaults to 'worker', which
    // requires job_title/start_date/employment_type (every non-admin role
    // does) -- supplied here so these cases test phone validation in
    // isolation, not tripping the unrelated onboarding-field requirement.
    it.each(VALID)('accepts a valid E.164 phone: %s', (phone) => {
      const result = CreateUserSchema.safeParse({
        email: 'a@b.com',
        password: 'password123',
        first_name: 'A',
        last_name: 'B',
        phone,
        job_title: 'Cleaner',
        start_date: '2026-09-01',
        employment_type: 'FULL_TIME',
      });
      expect(result.success).toBe(true);
    });

    it.each(INVALID)('rejects a malformed phone: %s', (phone) => {
      const result = CreateUserSchema.safeParse({
        email: 'a@b.com',
        password: 'password123',
        first_name: 'A',
        last_name: 'B',
        phone,
      });
      expect(result.success).toBe(false);
    });

    it('rejects when phone is omitted (required)', () => {
      const result = CreateUserSchema.safeParse({
        email: 'a@b.com',
        password: 'password123',
        first_name: 'A',
        last_name: 'B',
      });
      expect(result.success).toBe(false);
    });
  });

  /**
   * THE PRODUCTION REPORT, 2026-09-15: the New user form, a German mobile
   * number written the way Germans write it, and "Request body validation
   * failed". Stored as ONE spelling (E.164), so the unique index on phone
   * still means one account per number.
   */
  describe('national and spaced formats are stored as E.164', () => {
    const base = { email: 'a@b.com', password: 'password123', first_name: 'A', last_name: 'B' };

    it.each([
      ['016090744182', '+4916090744182'],
      ['0160 907 441 82', '+4916090744182'],
      ['0160/90744182', '+4916090744182'],
      ['+49 (0) 160 90744182', '+4916090744182'],
      ['0049 160 90744182', '+4916090744182'],
      ['+49 160 90744182', '+4916090744182'],
      ['0123456789', '+49123456789'],
      ['+91 98765 43210', '+919876543210'],
    ])('stores %s as %s', (typed, stored) => {
      const result = CreateUserSchema.safeParse({ ...base, phone: typed });
      expect(result.success).toBe(true);
      expect(result.success && result.data.phone).toBe(stored);
    });

    it('normalises on profile edits too, so one number never has two spellings', () => {
      const result = UpdateUserProfileSchema.safeParse({ phone: '0160 90744182' });
      expect(result.success && result.data.phone).toBe('+4916090744182');
    });
  });

  describe('UpdateUserSchema', () => {
    it('rejects a malformed phone', () => {
      const result = UpdateUserSchema.safeParse({ phone: 'not-a-phone' });
      expect(result.success).toBe(false);
    });

    it('accepts a valid E.164 phone', () => {
      const result = UpdateUserSchema.safeParse({ phone: '+14155552671' });
      expect(result.success).toBe(true);
    });

    it('allows phone to be explicitly null (unchanged nullable behavior)', () => {
      const result = UpdateUserSchema.safeParse({ phone: null });
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateUserProfileSchema', () => {
    it('rejects a malformed phone', () => {
      const result = UpdateUserProfileSchema.safeParse({ phone: 'not-a-phone' });
      expect(result.success).toBe(false);
    });

    it('accepts a valid E.164 phone', () => {
      const result = UpdateUserProfileSchema.safeParse({ phone: '+14155552671' });
      expect(result.success).toBe(true);
    });

    it('allows phone to be explicitly null (unchanged nullable behavior)', () => {
      const result = UpdateUserProfileSchema.safeParse({ phone: null });
      expect(result.success).toBe(true);
    });
  });
});
