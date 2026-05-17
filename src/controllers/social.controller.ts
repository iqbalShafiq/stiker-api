import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { SocialService } from '../services/social.service';
import { ValidationError } from '../errors';
import { buildSuccessResponse } from '../utils/response-builder';

export class SocialController {
  private socialService: SocialService;

  constructor() {
    this.socialService = new SocialService();
  }

  async likePack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = this.requireUserAndPack(req);
      const result = await this.socialService.likePack(id, req.user!.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async unlikePack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = this.requireUserAndPack(req);
      const result = await this.socialService.unlikePack(id, req.user!.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async savePack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = this.requireUserAndPack(req);
      const result = await this.socialService.savePack(id, req.user!.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async unsavePack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = this.requireUserAndPack(req);
      const result = await this.socialService.unsavePack(id, req.user!.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async downloadPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = this.requireUserAndPack(req);
      const result = await this.socialService.recordPackDownload(id, req.user!.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async followUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      if (!id) {
        throw new ValidationError('User ID is required');
      }

      const result = await this.socialService.followUser(id, req.user.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async unfollowUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      if (!id) {
        throw new ValidationError('User ID is required');
      }

      const result = await this.socialService.unfollowUser(id, req.user.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  private requireUserAndPack(req: AuthRequest): { id: string } {
    if (!req.user?.id) {
      throw new ValidationError('User not authenticated');
    }

    const { id } = req.params;
    if (!id) {
      throw new ValidationError('Sticker pack ID is required');
    }

    return { id };
  }
}
