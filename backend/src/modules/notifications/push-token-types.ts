import { z } from 'zod';
import { PushApp, PushPlatform } from '@prisma/client';

// Epic 7 PR 7.5 (ADR-029 §4): device push-token registration.
// `app` (Epic 7 PR 7.8) is required, not optional: PushToken.app is NOT NULL
// with no default (the table carries zero rows in every environment, so there
// is no existing caller and no compatibility concern), and the transport
// assumes every row has it — an optional field here would just move the
// impossible-null problem from the schema into this endpoint instead of
// removing it.
export const RegisterPushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.nativeEnum(PushPlatform),
  app: z.nativeEnum(PushApp),
});

export type RegisterPushTokenInput = z.infer<typeof RegisterPushTokenSchema>;
