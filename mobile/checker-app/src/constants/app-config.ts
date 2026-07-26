import type { PushApp, UserRole } from '@/types/api';

export const APP_NAME = 'Checker Portal';
// regional_manager added (ADR-030 PR-3): RM holds manager's capability set
// at group scope, so may sign into this app exactly as manager does today.
export const ALLOWED_ROLES: readonly UserRole[] = ['checker', 'manager', 'admin', 'regional_manager'];

/**
 * Which application this build is, as the backend's `PushApp` (Epic 7 PR 7.7).
 * Sent with every push-token registration so the Platform Worker can select
 * the matching APNs topic — worker-app and checker-app have distinct bundle
 * IDs, and `manager`/`admin` may be signed into both, so the token alone
 * cannot identify the app (PR 7.8).
 *
 * This constant is the ONLY per-app difference in the push-registration path;
 * everything else in `lib/push-notifications.ts` is identical across the two
 * apps deliberately, so they stay in sync.
 */
export const PUSH_APP: PushApp = 'CHECKER';

/**
 * Pivot cutover feature flag (S0-4): toggles the dispatch model between the
 * legacy marketplace (worker applications) and the new direct-dispatch
 * (broadcast/assignment) flow. See docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md.
 */
export type PivotMode = 'marketplace' | 'direct_dispatch';

export const PIVOT_MODE: PivotMode =
  process.env.EXPO_PUBLIC_PIVOT_MODE === 'direct_dispatch' ? 'direct_dispatch' : 'marketplace';

export const isDirectDispatchMode = (): boolean => PIVOT_MODE === 'direct_dispatch';
