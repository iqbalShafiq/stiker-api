import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { ShareService } from '../services/share.service';
import { StickerPackShareService } from '../services/sticker-pack-share.service';
import { ValidationError } from '../errors';
import { buildSuccessResponse } from '../utils/response-builder';

export class ShareController {
  private stickerShareService: ShareService;
  private packShareService: StickerPackShareService;

  constructor() {
    this.stickerShareService = new ShareService();
    this.packShareService = new StickerPackShareService();
  }

  async previewPack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.params;
      if (!token) {
        throw new ValidationError('Share token is required');
      }

      const link = await this.packShareService.getShareLinkPreview(token);
      res.status(200).json(buildSuccessResponse({
        resourceType: 'pack',
        permission: this.mapPermission(link.permission),
        expiresAt: link.expiresAt,
        maxUses: link.maxUses,
        usesCount: link.usesCount,
        stickerPack: link.stickerPack,
      }));
    } catch (error) {
      next(error);
    }
  }

  async acceptPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { token } = req.params;
      if (!token) {
        throw new ValidationError('Share token is required');
      }

      const stickerPack = await this.packShareService.acceptShareLink(token, req.user.id);
      res.status(201).json(buildSuccessResponse({ resourceType: 'pack', stickerPack }));
    } catch (error) {
      next(error);
    }
  }

  async previewSticker(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.params;
      if (!token) {
        throw new ValidationError('Share token is required');
      }

      const link = await this.stickerShareService.getShareLinkPreview(token);
      res.status(200).json(buildSuccessResponse({
        resourceType: 'sticker',
        permission: this.mapPermission(link.permission),
        expiresAt: link.expiresAt,
        maxUses: link.maxUses,
        usesCount: link.usesCount,
        sticker: link.sticker,
      }));
    } catch (error) {
      next(error);
    }
  }

  async acceptSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { token } = req.params;
      if (!token) {
        throw new ValidationError('Share token is required');
      }

      const sticker = await this.stickerShareService.acceptShareLink(token, req.user.id);
      res.status(201).json(buildSuccessResponse({ resourceType: 'sticker', sticker }));
    } catch (error) {
      next(error);
    }
  }

  private mapPermission(permission: string): 'view' | 'full' {
    return permission === 'EDIT' ? 'full' : 'view';
  }
}
