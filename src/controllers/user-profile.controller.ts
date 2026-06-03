import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { UserProfileService } from '../services/user-profile.service';
import { ValidationError } from '../errors';
import { buildPaginatedSuccessResponse, buildSuccessResponse } from '../utils/response-builder';
import type { PublicStickerPackSort } from '../utils/pack-query';

export class UserProfileController {
  private userProfileService = new UserProfileService();

  async getPublicProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ValidationError('User ID is required');
      }
      const profile = await this.userProfileService.getPublicProfile(id, req.user?.id);
      res.status(200).json(buildSuccessResponse(profile));
    } catch (error) {
      next(error);
    }
  }

  async getPublicPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ValidationError('User ID is required');
      }
      const page = typeof req.query.page === 'string' ? Number(req.query.page) : undefined;
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const sort = typeof req.query.sort === 'string' ? req.query.sort as PublicStickerPackSort : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const result = await this.userProfileService.getPublicPacksByOwner(id, { page, limit, sort, q });
      res.status(200).json(buildPaginatedSuccessResponse(result.data, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async searchUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
      const users = await this.userProfileService.searchUsers(q, limit);
      res.status(200).json(buildSuccessResponse(users));
    } catch (error) {
      next(error);
    }
  }
}
