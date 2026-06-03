import { Request, Response, NextFunction } from 'express';
import { hrService } from './service.js';

export class HrController {
  async createContract(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.createContract(req.body);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async listContracts(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.listContracts(req.query);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async createPayroll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.createPayroll(req.body);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async listPayroll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.listPayroll(req.query);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadDocument(_req: Request, _res: Response, next: NextFunction) {
    try {
      throw new Error('Not implemented');
    } catch (error) {
      next(error);
    }
  }
}

export const hrController = new HrController();
