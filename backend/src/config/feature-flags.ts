import { getEnv } from './env.js';

export type PivotMode = 'marketplace' | 'direct_dispatch';

/** The configured dispatch model (S0-4 pivot cutover flag). */
export function getPivotMode(): PivotMode {
  return getEnv().PIVOT_MODE;
}

/** True once the direct-dispatch (broadcast/assignment) flow is enabled. */
export function isDirectDispatchMode(): boolean {
  return getPivotMode() === 'direct_dispatch';
}
