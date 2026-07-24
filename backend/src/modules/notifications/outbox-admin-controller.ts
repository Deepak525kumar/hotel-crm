import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { outboxAdminService } from './outbox-admin-service.js';
import { ListDeadLettersQuerySchema } from './outbox-admin-types.js';

/**
 * Operator endpoints over state-outbox (Epic 7 PR 7.6, ADR-029 §9). Function-style
 * to match the newer controllers (attendance, employee-management). Route-level
 * `requireRole('admin')` is the authorization gate; these handlers assume it ran.
 */

function meta(req: Request) {
  return { timestamp: new Date().toISOString(), request_id: req.requestId };
}

export async function getOutboxMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) throw new UnauthorizedError('Not authenticated');
    const data = await outboxAdminService.getMetrics();
    res.status(200).json({ status: 'success', data, meta: meta(req) });
  } catch (error) {
    next(error);
  }
}

export async function listDeadLetters(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) throw new UnauthorizedError('Not authenticated');
    const parsed = ListDeadLettersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid query parameters',
        parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }))
      );
    }

    const { page, per_page } = parsed.data;
    const { data, total } = await outboxAdminService.listDeadLetters(parsed.data);

    res.status(200).json({
      status: 'success',
      data,
      pagination: {
        page,
        per_page,
        total,
        total_pages: Math.ceil(total / per_page),
        has_next: page * per_page < total,
        has_prev: page > 1,
      },
      meta: meta(req),
    });
  } catch (error) {
    next(error);
  }
}

export async function requeueDeadLetter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) throw new UnauthorizedError('Not authenticated');
    const data = await outboxAdminService.requeue(
      req.params.outbox_id,
      { userId: req.auth.userId, role: req.auth.role },
      req.ip
    );
    res.status(200).json({ status: 'success', data, meta: meta(req) });
  } catch (error) {
    next(error);
  }
}

export async function discardDeadLetter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) throw new UnauthorizedError('Not authenticated');
    const data = await outboxAdminService.discard(
      req.params.outbox_id,
      { userId: req.auth.userId, role: req.auth.role },
      req.ip
    );
    res.status(200).json({ status: 'success', data, meta: meta(req) });
  } catch (error) {
    next(error);
  }
}
