import { z } from 'zod';

export const SignupSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[0-9]/, 'Password must contain number'),
  first_name: z
    .string()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name too long'),
  last_name: z
    .string()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name too long'),
  phone: z
    .string()
    .optional()
    .refine(val => !val || /^\+?[1-9]\d{1,14}$/.test(val), 'Invalid phone format'),
  hotel_ids: z
    .array(z.string().uuid('Invalid hotel ID'))
    .optional()
    .default([]),
  role: z
    .enum(['worker', 'checker', 'manager', 'admin'])
    .optional()
    .default('worker'),
});

export const LoginSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export const UpdateProfileSchema = z.object({
  first_name: z
    .string()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name too long')
    .optional(),
  last_name: z
    .string()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name too long')
    .optional(),
  phone: z
    .string()
    .refine(val => /^\+?[1-9]\d{1,14}$/.test(val), 'Invalid phone format')
    .optional(),
  profile_photo_url: z
    .string()
    .url('Invalid URL')
    .optional(),
});

export type SignupRequest = z.infer<typeof SignupSchema>;
export type LoginRequest = z.infer<typeof LoginSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileSchema>;
