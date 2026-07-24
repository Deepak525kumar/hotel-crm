import { z } from 'zod';
import { PushPlatform } from '@prisma/client';

// Epic 7 PR 7.5 (ADR-029 §4): device push-token registration.
export const RegisterPushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.nativeEnum(PushPlatform),
});

export type RegisterPushTokenInput = z.infer<typeof RegisterPushTokenSchema>;
