import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../lib/errors.js';
import { sendPaginated, sendSuccess } from '../../lib/http-envelope.js';
import { assignmentService } from './service.js';
import {
  CreateCalendarEntrySchema,
  ListAssignmentsQuerySchema,
  ListCalendarEntriesQuerySchema,
  LogRoomsCompletedSchema,
  MoveCalendarEntrySchema,
  ReassignAssignmentSchema,
  UpdateAssignmentSchema,
} from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export async function listAssignments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ListAssignmentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await assignmentService.list(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    const { page, per_page } = parsed.data;
    sendPaginated(
      res,
      data,
      {
        page,
        per_page,
        total,
        total_pages: Math.ceil(total / per_page),
        has_next: page * per_page < total,
        has_prev: page > 1,
      },
      { requestId: req.requestId }
    );
  } catch (error) {
    next(error);
  }
}

export async function getAssignment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await assignmentService.getById(req.params.id, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

export async function updateAssignment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = UpdateAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await assignmentService.update(
      req.params.id,
      parsed.data,
      req.auth!.userId,
      req.auth!.role,
      req.auth!.scope ?? null
    );
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

// Job-dispatch lifecycle feature (2026-08-05): atomic reassign.
export async function reassignAssignment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ReassignAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await assignmentService.reassign(req.params.id, parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { statusCode: 201, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

// ADR-028 (OQ-ANALYTICS-03): manager logs a "rooms completed" count for a
// worker's full-day assignment.
export async function logRoomsCompleted(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = LogRoomsCompletedSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await assignmentService.logRoomsCompleted(req.params.id, parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { statusCode: 201, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

// 2026-08-09: correction path for an already-logged entry. See
// AssignmentService.updateRoomsCompleted's own comment for why this is a
// separate endpoint rather than turning POST into an upsert.
export async function updateRoomsCompleted(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = LogRoomsCompletedSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await assignmentService.updateRoomsCompleted(req.params.id, parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { statusCode: 200, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

// Epic 9 PR 9.5 (TREQ-001/TRULE-001, MIG-GAP-03): manager places a worker
// directly on the calendar for a given day — no accept/decline step.
export async function createCalendarEntry(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = CreateCalendarEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await assignmentService.placeOnCalendar(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { statusCode: 201, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

// Calendar grid view: drag/drop scheduling. Day-only move (product decision,
// 2026-08-05) — hotel/worker are unchanged.
export async function moveCalendarEntry(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = MoveCalendarEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await assignmentService.moveCalendarEntry(req.params.id, parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

export async function listCalendarEntries(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ListCalendarEntriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await assignmentService.listCalendarEntries(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      // IDOR fix (2026-08-10): the scope claim was previously not passed at
      // all, so the service could not scope a manager/RM even in principle.
      scope: req.auth!.scope ?? null,
    });
    const { page, per_page } = parsed.data;
    sendPaginated(
      res,
      data,
      {
        page,
        per_page,
        total,
        total_pages: Math.ceil(total / per_page),
        has_next: page * per_page < total,
        has_prev: page > 1,
      },
      { requestId: req.requestId }
    );
  } catch (error) {
    next(error);
  }
}
