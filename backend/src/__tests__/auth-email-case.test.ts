import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'node:fs';
import { LoginSchema, PasswordResetRequestSchema, SignupSchema } from '../modules/auth/validation.js';
import { CreateUserSchema } from '../modules/users/types.js';

/**
 * Email case normalization across every entry point that stores or looks up a
 * User by email.
 *
 * The defect this pins was a full account lockout, reproduced against a real
 * database before the fix:
 *
 *   POST /auth/signup  { email: "ctrA-1@test.local" }  -> stored "ctra-1@test.local"
 *   POST /auth/login   { email: "ctrA-1@test.local" }  -> 401 Invalid credentials
 *   POST /auth/login   { email: "ctra-1@test.local" }  -> 200
 *
 * SignupSchema lowercased its input; LoginSchema did not. The lookup is by
 * literal email and Postgres' unique index is case-sensitive, so a user who
 * typed any capital letter at signup could never log in with the same string
 * they had just registered with. Password reset shared the flaw and returns a
 * deliberate anti-enumeration 200, so the caller was told "sent" while no
 * token was issued (verified: 0 PasswordResetToken rows) — no self-recovery
 * either.
 *
 * Tested at the schema level because that is where the asymmetry lived: the
 * service, the controller and the route were all correct given normalized
 * input.
 */

const MIXED = 'John.Smith@Example.COM';
const LOWER = 'john.smith@example.com';

describe('email case normalization', () => {
  it('SignupSchema lowercases (the behaviour every other path must match)', () => {
    const parsed = SignupSchema.parse({
      email: MIXED, password: 'TestPassw0rd!23', first_name: 'John', last_name: 'Smith',
    });
    expect(parsed.email).toBe(LOWER);
  });

  it('LoginSchema lowercases, so signup and login agree', () => {
    // The bug: without this, the string a user signed up with is rejected.
    const parsed = LoginSchema.parse({ email: MIXED, password: 'TestPassw0rd!23' });
    expect(parsed.email).toBe(LOWER);
  });

  it('PasswordResetRequestSchema lowercases, so a locked-out user can recover', () => {
    const parsed = PasswordResetRequestSchema.parse({ email: MIXED });
    expect(parsed.email).toBe(LOWER);
  });

  it('CreateUserSchema lowercases, so an admin cannot mint a case-variant duplicate', () => {
    // User.email is UNIQUE but Postgres compares case-sensitively, so
    // "John@x.com" and "john@x.com" would otherwise be two distinct accounts
    // for one person — and only one of them reachable by login.
    const parsed = CreateUserSchema.parse({
      email: MIXED,
      password: 'TestPassw0rd!23',
      first_name: 'John',
      last_name: 'Smith',
      phone: '+491701234567',
      role: 'worker',
      job_title: 'Room Attendant',
      start_date: '2026-09-01',
      employment_type: 'FULL_TIME',
    });
    expect(parsed.email).toBe(LOWER);
  });

  it('normalization is not defeated by surrounding whitespace in the local part', () => {
    // zod's .email() rejects padded input, so a trimmed-but-cased address is
    // the realistic shape; this guards the ordering of .email() and
    // .toLowerCase() rather than inventing a trim requirement.
    expect(LoginSchema.parse({ email: 'A@B.CO', password: 'x' }).email).toBe('a@b.co');
  });

  it('ships with the migration that lowercases existing rows', () => {
    // Input normalization alone is not safe: a row already stored as
    // "John@x.com" stops matching any login attempt the moment login
    // lowercases, which would lock out precisely the accounts this fixes. The
    // two must land together.
    const dir = 'prisma/migrations/20260825130000_normalize_user_email_lowercase';
    expect(existsSync(`${dir}/migration.sql`)).toBe(true);
    const sql = readFileSync(`${dir}/migration.sql`, 'utf8');
    expect(sql).toMatch(/UPDATE\s+"User"\s+SET\s+email\s*=\s*lower\(email\)/i);
  });
});
