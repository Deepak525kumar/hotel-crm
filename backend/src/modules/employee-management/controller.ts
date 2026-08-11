import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { employeeManagementService } from './service.js';
import {
  ApproveEmployeeSchema,
  BlocklistQuerySchema,
  BulkImportSchema,
  ByUserParamsSchema,
  CreateEmployeeSchema,
  DeactivateEmployeeSchema,
  DeleteEmployeeSchema,
  OrgChartParamsSchema,
  ProfileHistoryQuerySchema,
  RejectEmployeeSchema,
  SetBlocklistSchema,
  SpecialCategoryParamsSchema,
  type SpecialCategoryField,
} from './types.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validation.js';
import { UnauthorizedError } from '../../lib/errors.js';

export class EmployeeManagementController {
  createEmployee = [
    validateBody(CreateEmployeeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.createEmployee(req.auth, req.body);
        res.status(201).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  bulkImport = [
    validateBody(BulkImportSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.bulkImport(req.auth, req.body.rows);
        res.status(201).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  getByUserId = [
    validateParams(ByUserParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.getByUserId(req.auth, req.params['user_id']!);
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  getProfileHistory = [
    validateQuery(ProfileHistoryQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.getProfileHistory(
          req.auth,
          req.params['employee_id']!,
          req.query as never
        );
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async getSkills(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.getSkills(req.auth, req.params['employee_id']!);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  getSpecialCategory = [
    validateParams(SpecialCategoryParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const field = req.params['field'] as SpecialCategoryField;
        const result = await employeeManagementService.getSpecialCategory(
          req.auth,
          req.params['employee_id']!,
          field
        );
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async getReviewQueue(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.getReviewQueue(req.auth);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async exportEmployeeData(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.exportEmployeeData(req.auth, req.params['employee_id']!);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Lifecycle actions (REQ-EMP-002 rework, 2026-08-06) ──────────────────
  // One handler per transition, replacing the single lifecycle-signal
  // endpoint — see types.ts for why the generic {signal, ...} body could not
  // carry the rework's per-action required fields. All seven return the
  // updated general profile with 200, matching the shape the pre-rework
  // deactivate/lifecycleSignal handlers already returned.

  // PENDING -> PENDING (submitted_for_review_at only; not a status change).
  async submitForReview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.submitForReview(req.auth, req.params['employee_id']!);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  approve = [
    validateBody(ApproveEmployeeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.approve(req.auth, req.params['employee_id']!);
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  assign = [
    validateBody(
      z.object({
        hotel_group_id: z.string().optional(),
        primary_hotel_id: z.string().optional(),
      })
    ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.assign(req.auth, req.params['employee_id']!, {
          hotel_group_id: req.body.hotel_group_id,
          primary_hotel_id: req.body.primary_hotel_id,
        });
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  reject = [
    validateBody(RejectEmployeeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.reject(
          req.auth,
          req.params['employee_id']!,
          req.body.reason
        );
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  deactivate = [
    validateBody(DeactivateEmployeeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.deactivate(
          req.auth,
          req.params['employee_id']!,
          req.body.deactivation_reason
        );
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async reactivate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.reactivate(req.auth, req.params['employee_id']!);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async rehire(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.rehire(req.auth, req.params['employee_id']!);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  deleteEmployee = [
    validateBody(DeleteEmployeeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.delete(
          req.auth,
          req.params['employee_id']!,
          req.body.deleted_reason
        );
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async restore(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.restore(req.auth, req.params['employee_id']!);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  getBlocklist = [
    validateQuery(BlocklistQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const query = req.query as { employee_id?: string; page?: number; limit?: number };
        const result = await employeeManagementService.getBlocklist(req.auth, {
          hotelId: req.params['hotel_id']!,
          employeeId: query.employee_id,
          page: query.page,
          limit: query.limit,
        });
        res.status(200).json({
          status: 'success',
          data: result.data,
          meta: { total: result.total, timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  setBlocklist = [
    validateBody(SetBlocklistSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.setBlocklist(req.auth, {
          hotelId: req.params['hotel_id']!,
          employeeId: req.body.employee_id,
          reason: req.body.reason,
        });
        res.status(201).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async removeBlocklist(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      await employeeManagementService.removeBlocklist(req.auth, req.params['hotel_id']!, req.params['entry_id']!);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  getOrgChart = [
    validateParams(OrgChartParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.getOrgChart(
          req.auth,
          req.params['hotel_group_id']!
        );
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];
}

export const employeeManagementController = new EmployeeManagementController();
