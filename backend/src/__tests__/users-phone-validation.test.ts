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
  const INVALID = ['not-a-phone', '0123456789', '+', 'abc123', '++14155552671'];

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
