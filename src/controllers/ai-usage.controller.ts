import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { ValidationError } from '../errors';
import { buildSuccessResponse } from '../utils/response-builder';
import { aiUsageService } from '../services/ai-usage.service';

export class AiUsageController {
  async getUsage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const usage = await aiUsageService.getUsage(req.user.id);
      res.status(200).json(buildSuccessResponse(usage));
    } catch (error) {
      next(error);
    }
  }
}
