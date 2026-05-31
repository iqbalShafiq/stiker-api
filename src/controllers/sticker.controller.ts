import type { Response, NextFunction } from 'express';
import { StickerService } from '../services/sticker.service';
import { ShareService } from '../services/share.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError, NotFoundError, ForbiddenError } from '../errors';
import { SharePermission } from '@prisma/client';
import { withShareLinkUrls } from '../utils/share-links';

export class StickerController {
  private stickerService: StickerService;
  private shareService: ShareService;

  constructor() {
    this.stickerService = new StickerService();
    this.shareService = new ShareService();
  }

  private mapStickerResponse(sticker: Record<string, unknown>): Record<string, unknown> {
    if (sticker && typeof sticker.visibility === 'string') {
      sticker.visibility = sticker.visibility.toLowerCase();
    }
    return sticker;
  }

  private mapShareResponse(share: Record<string, unknown>): Record<string, unknown> {
    if (share && typeof share.permission === 'string') {
      share.permission = share.permission === 'EDIT' ? 'full' : share.permission.toLowerCase();
    }
    return share;
  }

  private withStickerShareUrl(_req: AuthRequest, link: Record<string, unknown>): Record<string, unknown> {
    const token = String(link.token ?? '');
    return withShareLinkUrls('sticker', token, link);
  }

  async getMyStickers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const stickers = await this.stickerService.findByOwner(req.user.id);
      res.status(200).json(buildSuccessResponse(stickers));
    } catch (error) {
      next(error);
    }
  }

  async getPublicStickers(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const stickers = await this.stickerService.findPublic();
      res.status(200).json(buildSuccessResponse(stickers));
    } catch (error) {
      next(error);
    }
  }

  async getSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      const sticker = await this.stickerService.findById(id);

      if (!sticker) {
        throw new NotFoundError('Sticker not found');
      }

      if (req.user?.id) {
        const hasAccess = await this.stickerService.checkAccess(id, req.user.id, 'read');
        if (!hasAccess && sticker.visibility !== 'PUBLIC') {
          throw new ForbiddenError('You do not have permission to view this sticker');
        }
      } else if (sticker.visibility !== 'PUBLIC') {
        throw new ValidationError('Authentication required');
      }

      res.status(200).json(buildSuccessResponse(this.mapStickerResponse(sticker as Record<string, unknown>)));
    } catch (error) {
      next(error);
    }
  }

  async updateSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { name, visibility } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      const updateData: { name?: string; visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' } = {};

      if (name !== undefined) {
        updateData.name = String(name);
      }

      if (visibility !== undefined) {
        updateData.visibility = String(visibility).toUpperCase() as 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
      }

      const sticker = await this.stickerService.update(id, req.user.id, updateData);
      res.status(200).json(buildSuccessResponse(this.mapStickerResponse(sticker as Record<string, unknown>)));
    } catch (error) {
      next(error);
    }
  }

  async deleteSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      await this.stickerService.delete(id, req.user.id);
      res.status(200).json(buildSuccessResponse({ message: 'Sticker deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async shareWithUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { userId: sharedWithId, permission, expiresAt } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      if (!sharedWithId) {
        throw new ValidationError('User ID is required');
      }

      const permissionStr = String(permission).toLowerCase();
      const sharePermission = permission
        ? (permissionStr === 'full' ? SharePermission.EDIT : (permissionStr.toUpperCase() as SharePermission))
        : SharePermission.VIEW;
      const expirationDate = expiresAt ? new Date(String(expiresAt)) : undefined;

      const share = await this.shareService.shareWithUser(
        id,
        req.user.id,
        String(sharedWithId),
        sharePermission,
        expirationDate
      );

      res.status(201).json(buildSuccessResponse(this.mapShareResponse(share as Record<string, unknown>)));
    } catch (error) {
      next(error);
    }
  }

  async removeUserShare(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { userId: sharedWithId } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      if (!sharedWithId) {
        throw new ValidationError('User ID is required');
      }

      await this.shareService.removeUserShare(id, req.user.id, String(sharedWithId));
      res.status(200).json(buildSuccessResponse({ message: 'Share removed successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async createShareLink(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { permission, expiresAt, maxUses } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      const permissionStr = String(permission).toLowerCase();
      const sharePermission = permission
        ? (permissionStr === 'full' ? SharePermission.EDIT : (permissionStr.toUpperCase() as SharePermission))
        : SharePermission.VIEW;
      const expirationDate = expiresAt ? new Date(String(expiresAt)) : undefined;
      const usesLimit = maxUses ? Number(maxUses) : undefined;

      const link = await this.shareService.createShareLink(
        id,
        req.user.id,
        sharePermission,
        expirationDate,
        usesLimit
      );

      res.status(201).json(buildSuccessResponse(this.withStickerShareUrl(req, this.mapShareResponse(link as Record<string, unknown>))));
    } catch (error) {
      next(error);
    }
  }

  async listShareLinks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      const links = await this.shareService.listActiveLinks(id, req.user.id);
      res.status(200).json(buildSuccessResponse(links.map((link) => this.withStickerShareUrl(req, this.mapShareResponse(link as Record<string, unknown>)))));
    } catch (error) {
      next(error);
    }
  }

  async revokeShareLink(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id, linkId } = req.params;

      if (!id) {
        throw new ValidationError('Sticker ID is required');
      }

      if (!linkId) {
        throw new ValidationError('Link ID is required');
      }

      await this.shareService.revokeShareLink(id, req.user.id, linkId);
      res.status(200).json(buildSuccessResponse({ message: 'Share link revoked successfully' }));
    } catch (error) {
      next(error);
    }
  }
}
