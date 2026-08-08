import { z } from 'zod';

export const SignupSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit'),
  first_name: z.string().min(2).max(50),
  last_name: z.string().min(2).max(50),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  // SECURITY (HOTFIX-AUTH-001): public signup must never accept a client-supplied
  // role. Privileged roles are assigned server-side only (via the users module).
  // The `role` field is intentionally excluded so any injected value is stripped.
}).strict();

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Security #4 (2026-08-09): optional, not required. The web client sends no
// body at all for /auth/refresh -- its refresh token travels in the
// httpOnly cookie instead (controller.ts resolves cookie-vs-body before
// calling the service). Mobile still sends this field. "at least one of
// cookie or body must be present" is enforced in the controller, since a
// Zod schema has no visibility into cookies.
export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required').optional(),
});

export const UpdateProfileSchema = z.object({
  first_name: z.string().min(2).max(50).optional(),
  last_name: z.string().min(2).max(50).optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  profile_photo_url: z.string().url('Invalid URL').optional(),
});

// HOTFIX-AUTH-002: password reset is a two-step, server-authoritative flow.
// The request step accepts only an email (never a new password) and never
// reveals account existence; the confirm step requires the single-use token
// issued by the request step as proof of email ownership.
export const PasswordResetRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
}).strict();

export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  new_password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit'),
}).strict();

export type SignupRequest = z.infer<typeof SignupSchema>;
export type LoginRequest = z.infer<typeof LoginSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileSchema>;
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmSchema>;
