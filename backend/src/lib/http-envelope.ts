import { Response } from 'express';

/**
 * Shared success-envelope helpers (Epic 9 PR 9.1).
 *
 * Pure extraction of the response shape every job-dispatch-family controller
 * already constructed inline (e.g. `work-requests/controller.ts:30-34,56-68`
 * pre-PR-9.1) — no contract change. `MODULE_SPEC.md:498` (job-dispatch)
 * presupposes these helpers exist under Phase 1's "refactor the success
 * envelope behind `sendSuccess()`/`sendPaginated()`"; they did not, this PR
 * creates them and points `work-requests` and `assignments` controllers at
 * them (`work-applications` was a third consumer at authoring time; the
 * module was removed in PR 9.2).
 */

interface Meta {
  timestamp: string;
  request_id: string | undefined;
  [key: string]: unknown;
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

function buildMeta(requestId: string | undefined, extra?: Record<string, unknown>): Meta {
  return {
    timestamp: new Date().toISOString(),
    request_id: requestId,
    ...(extra ?? {}),
  };
}

// Sends `{status:'success', data, meta:{timestamp, request_id}}` at the given
// status code — identical to the inline shape every handler built before this
// PR. `extra` merges additional keys into `meta` only (no handler needed this
// before PR 9.1; kept for forward compatibility, unused by any call site
// introduced in this PR).
export function sendSuccess(
  res: Response,
  data: unknown,
  options?: { statusCode?: number; requestId?: string; meta?: Record<string, unknown> }
): void {
  res.status(options?.statusCode ?? 200).json({
    status: 'success',
    data,
    meta: buildMeta(options?.requestId, options?.meta),
  });
}

// Sends `{status:'success', data, pagination, meta:{timestamp, request_id}}` —
// identical to the inline paginated shape every list handler built before
// this PR.
export function sendPaginated(
  res: Response,
  data: unknown,
  pagination: Pagination,
  options?: { statusCode?: number; requestId?: string; meta?: Record<string, unknown> }
): void {
  res.status(options?.statusCode ?? 200).json({
    status: 'success',
    data,
    pagination,
    meta: buildMeta(options?.requestId, options?.meta),
  });
}
