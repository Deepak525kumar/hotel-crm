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

/**
 * Branding and build identity.
 *
 * Kept out of AppShell (2026-08-07, review): the shell is reusable layout, so
 * baking an owner name into it would have to be edited rather than configured
 * if this product is ever white-labelled or reused. Overridable per
 * environment like every other value here.
 */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Hotel CRM";
export const APP_OWNER = process.env.NEXT_PUBLIC_APP_OWNER ?? "Zirove";

/**
 * Release identity, surfaced on the Settings page.
 *
 * Not for users -- for support: when someone reports a problem, knowing the
 * exact build turns "I'm seeing X" into a specific commit. Both are injected
 * at build time; Vercel exposes the commit SHA as
 * NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, and the fallbacks make a local dev build
 * say so plainly rather than displaying a misleading value.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

const RAW_COMMIT_SHA =
  process.env.NEXT_PUBLIC_APP_COMMIT_SHA ??
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
  null;

/** Short SHA (7 chars), or `null` when built outside CI. */
export const APP_COMMIT_SHA = RAW_COMMIT_SHA ? RAW_COMMIT_SHA.slice(0, 7) : null;
