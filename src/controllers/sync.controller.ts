import type { Response, NextFunction } from 'express';
import { SyncService } from '../services/sync.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

export class SyncController {
  private syncService: SyncService;

  constructor() {
    this.syncService = new SyncService();
  }

  async sync(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('Authentication required');
      }

      const { lastSyncAt } = req.query as { lastSyncAt?: string };
      
      let parsedLastSyncAt: Date | undefined;
      if (lastSyncAt) {
        parsedLastSyncAt = new Date(lastSyncAt);
        if (isNaN(parsedLastSyncAt.getTime())) {
          throw new ValidationError('Invalid lastSyncAt date format');
        }
      }

      const result = await this.syncService.sync({
        userId: req.user.id,
        lastSyncAt: parsedLastSyncAt,
      });

      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }
}