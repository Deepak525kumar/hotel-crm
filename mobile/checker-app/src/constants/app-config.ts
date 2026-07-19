import type { UserRole } from '@/types/api';

export const APP_NAME = 'Checker Portal';
export const ALLOWED_ROLES: readonly UserRole[] = ['checker', 'manager', 'admin'];

/**
 * Pivot cutover feature flag (S0-4): toggles the dispatch model between the
 * legacy marketplace (worker applications) and the new direct-dispatch
 * (broadcast/assignment) flow. See docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md.
 */
export type PivotMode = 'marketplace' | 'direct_dispatch';

export const PIVOT_MODE: PivotMode =
  process.env.EXPO_PUBLIC_PIVOT_MODE === 'direct_dispatch' ? 'direct_dispatch' : 'marketplace';

export const isDirectDispatchMode = (): boolean => PIVOT_MODE === 'direct_dispatch';
