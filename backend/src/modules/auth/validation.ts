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
  role: z.enum(['worker', 'checker', 'manager', 'admin']).optional(),
  // hotel_ids retained transitionally; removed in Phase 5 (S-4)
  hotel_ids: z.array(z.string()).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export const UpdateProfileSchema = z.object({
  first_name: z.string().min(2).max(50).optional(),
  last_name: z.string().min(2).max(50).optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  profile_photo_url: z.string().url('Invalid URL').optional(),
});

export type SignupRequest = z.infer<typeof SignupSchema>;
export type LoginRequest = z.infer<typeof LoginSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileSchema>;
