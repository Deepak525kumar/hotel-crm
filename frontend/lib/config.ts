/**
 * Centralized runtime configuration.
 *
 * All values that vary per-environment are read from `NEXT_PUBLIC_*`
 * variables so they are inlined for the browser bundle at build time.
 */

const DEFAULT_API_BASE_URL = "http://localhost:3001/api/v1";

/**
 * Base URL for the backend API, including the version prefix
 * (e.g. `http://localhost:3001/api/v1`). Trailing slashes are stripped
 * so callers can safely concatenate paths beginning with `/`.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

/** localStorage key under which the auth store persists its state. */
export const AUTH_STORAGE_KEY = "hotel-crm.auth";

/**
 * Pivot cutover feature flag (S0-4): toggles the dispatch model between the
 * legacy marketplace (worker applications) and the new direct-dispatch
 * (broadcast/assignment) flow. See docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md.
 */
export type PivotMode = "marketplace" | "direct_dispatch";

export const PIVOT_MODE: PivotMode =
  process.env.NEXT_PUBLIC_PIVOT_MODE === "direct_dispatch" ? "direct_dispatch" : "marketplace";

export const isDirectDispatchMode = (): boolean => PIVOT_MODE === "direct_dispatch";
