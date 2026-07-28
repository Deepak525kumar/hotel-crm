import { Request, Response, NextFunction } from 'express';
import { employeeManagementService } from './service.js';
import {
  BlocklistQuerySchema,
  BulkImportSchema,
  CreateEmployeeSchema,
  LifecycleSignalSchema,
  OrgChartParamsSchema,
  ProfileHistoryQuerySchema,
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

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await employeeManagementService.deactivate(req.auth, req.params['employee_id']!);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  lifecycleSignal = [
    validateBody(LifecycleSignalSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const { signal, hotel_group_id } = req.body;
        const result = await employeeManagementService.lifecycleSignal(
          req.auth,
          req.params['employee_id']!,
          signal,
          { hotel_group_id }
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

  getBlocklist = [
    validateQuery(BlocklistQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await employeeManagementService.getBlocklist(req.auth, {
          hotelId: req.params['hotel_id']!,
          employeeId: (req.query as { employee_id?: string }).employee_id,
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
