import type { PushApp, UserRole } from '@hotel-crm/mobile-shared';

export const APP_NAME = 'Hotel CRM Manager';

/**
 * Who may use this app.
 *
 * All three roles in one binary (MANAGER_APP_PLAN.md D-1). `regional_manager`
 * is NOT an oversight to be tidied up later: it holds `manager`'s entire
 * capability set evaluated at hotel-group scope plus exactly one extra token
 * (`org_chart:read`), per ADR-030 D-5.
 *
 * Writing `['manager', 'admin']` here and adding RM "later" is this
 * codebase's single most repeated bug -- role gates are exact-match strings,
 * so the omission produces no error anywhere at roughly forty sites; the
 * regional manager simply finds the door locked with no message. Both strings
 * go in together, always.
 *
 * `worker` and `checker` are deliberately absent. They have their own apps,
 * and `src/app/wrong-app.tsx` tells them which rather than dropping them on
 * an empty dashboard.
 */
export const ALLOWED_ROLES: readonly UserRole[] = ['manager', 'regional_manager', 'admin'];

/**
 * Which application this build is, as the backend's `PushApp`.
 *
 * Sent with every push-token registration so the Platform Worker can select
 * the matching APNs topic. An admin may be signed into all three apps on one
 * device, so the device token alone cannot identify the app (Epic 7 PR 7.8).
 *
 * This constant is the ONLY per-app difference in the push-registration path;
 * everything in `lib/push-notifications.ts` is identical across the three apps
 * deliberately, so they stay in sync.
 */
export const PUSH_APP: PushApp = 'MANAGER';
