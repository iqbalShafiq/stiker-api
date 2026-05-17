import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { ProcessingHistoryService } from '../services/processing-history.service';
import { ValidationError } from '../errors';
import { buildSuccessResponse } from '../utils/response-builder';

export class ProcessingHistoryController {
  private processingHistoryService: ProcessingHistoryService;

  constructor() {
    this.processingHistoryService = new ProcessingHistoryService();
  }

  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const history = await this.processingHistoryService.findByUser(req.user.id, type);
      res.status(200).json(buildSuccessResponse(history));
    } catch (error) {
      next(error);
    }
  }

  async deleteOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      if (!id) {
        throw new ValidationError('Processing history ID is required');
      }

      await this.processingHistoryService.deleteByUser(id, req.user.id);
      res.status(200).json(buildSuccessResponse({ message: 'Processing history deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async clear(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const deletedCount = await this.processingHistoryService.clearByUser(req.user.id, type);
      res.status(200).json(buildSuccessResponse({ deletedCount }));
    } catch (error) {
      next(error);
    }
  }
}
