import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { NotificationService } from '../services/notification.service';
import { ValidationError } from '../errors';
import { buildPaginatedSuccessResponse, buildSuccessResponse } from '../utils/response-builder';

export class NotificationController {
  private notificationService = new NotificationService();

  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
      const unreadOnly = req.query.unreadOnly === 'true';
      const result = await this.notificationService.list(req.user.id, page, limit, unreadOnly);
      const body = buildPaginatedSuccessResponse(result.data, result.pagination);
      res.status(200).json({
        ...body,
        meta: {
          ...body.meta,
          unreadCount: result.unreadCount,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async markRead(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const { id } = req.params;
      if (!id) {
        throw new ValidationError('Notification ID is required');
      }
      await this.notificationService.markRead(id, req.user.id);
      res.status(200).json(buildSuccessResponse({ read: true }));
    } catch (error) {
      next(error);
    }
  }

  async markAllRead(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const count = await this.notificationService.markAllRead(req.user.id);
      res.status(200).json(buildSuccessResponse({ markedCount: count }));
    } catch (error) {
      next(error);
    }
  }
}
