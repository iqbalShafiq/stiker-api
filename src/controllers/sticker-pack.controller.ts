import type { Response, NextFunction } from 'express';
import { StickerPackService } from '../services/sticker-pack.service';
import { StickerPackShareService } from '../services/sticker-pack-share.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildPaginatedSuccessResponse, buildSuccessResponse } from '../utils/response-builder';
import { ValidationError, NotFoundError, ForbiddenError } from '../errors';
import { SharePermission } from '@prisma/client';
import { withShareLinkUrls } from '../utils/share-links';
import { notificationService } from '../services/notification.service';

export class StickerPackController {
  private stickerPackService: StickerPackService;
  private shareService: StickerPackShareService;

  constructor() {
    this.stickerPackService = new StickerPackService();
    this.shareService = new StickerPackShareService();
  }

  private withPackShareUrl(_req: AuthRequest, link: Record<string, unknown>): Record<string, unknown> {
    const token = String(link.token ?? '');
    return withShareLinkUrls('pack', token, link);
  }

  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { name, description, visibility, stickers } = req.body as Record<string, unknown>;

      if (!name || String(name).trim().length === 0) {
        throw new ValidationError('Sticker pack name is required');
      }

      const pack = await this.stickerPackService.create({
        ownerId: req.user.id,
        name: String(name),
        description: description ? String(description) : undefined,
        visibility: visibility ? String(visibility).toUpperCase() as 'PUBLIC' | 'PRIVATE' | 'UNLISTED' : undefined,
        stickers: Array.isArray(stickers) ? stickers.map((s: Record<string, unknown>) => ({
          name: String(s.name ?? 'Untitled'),
          filename: String(s.filename ?? ''),
          url: String(s.url ?? ''),
          width: s.width ? Number(s.width) : undefined,
          height: s.height ? Number(s.height) : undefined,
          fileSize: s.fileSize ? Number(s.fileSize) : undefined,
          mimeType: s.mimeType ? String(s.mimeType) : undefined,
          order: s.order ? Number(s.order) : undefined,
        })) : undefined,
      });

      res.status(201).json(buildSuccessResponse(pack));
    } catch (error) {
      next(error);
    }
  }

  async getMyStickerPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const packs = await this.stickerPackService.findByOwner(req.user.id);
      res.status(200).json(buildSuccessResponse(packs));
    } catch (error) {
      next(error);
    }
  }

  private parsePublicQuery(req: AuthRequest) {
    const page = typeof req.query.page === 'string' ? Number(req.query.page) : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const sort = typeof req.query.sort === 'string'
      ? req.query.sort as 'recent' | 'popular' | 'downloads' | 'likes' | 'saves'
      : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined;
    return { page, limit, sort, q, ownerId };
  }

  async getPublicStickerPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.stickerPackService.findPublicPaginated(
        this.parsePublicQuery(req),
        req.user?.id
      );
      res.status(200).json(buildPaginatedSuccessResponse(result.data, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async getSavedStickerPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const result = await this.stickerPackService.findSavedPaginated(req.user.id, this.parsePublicQuery(req));
      res.status(200).json(buildPaginatedSuccessResponse(result.data, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async getFollowingStickerPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const result = await this.stickerPackService.findFollowingPaginated(req.user.id, this.parsePublicQuery(req));
      res.status(200).json(buildPaginatedSuccessResponse(result.data, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async getSharedWithMeStickerPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const result = await this.stickerPackService.findSharedWithMePaginated(req.user.id, this.parsePublicQuery(req));
      res.status(200).json(buildPaginatedSuccessResponse(result.data, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async getPublicStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const pack = await this.stickerPackService.findPublicById(id, req.user?.id);
      if (!pack) {
        throw new NotFoundError('Public sticker pack not found');
      }

      res.status(200).json(buildSuccessResponse(pack));
    } catch (error) {
      next(error);
    }
  }

  async importPublicPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const result = await this.stickerPackService.importPublicPack(id, req.user.id);
      res.status(201).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async getStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const pack = await this.stickerPackService.findById(id);

      if (!pack) {
        throw new NotFoundError('Sticker pack not found');
      }

      if (req.user?.id) {
        const hasAccess = await this.stickerPackService.checkAccess(id, req.user.id, 'read');
        if (!hasAccess && pack.visibility !== 'PUBLIC') {
          throw new ForbiddenError('You do not have permission to view this sticker pack');
        }
      } else if (pack.visibility !== 'PUBLIC') {
        throw new ValidationError('Authentication required');
      }

      res.status(200).json(buildSuccessResponse(pack));
    } catch (error) {
      next(error);
    }
  }

  async updateStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { name, description, visibility } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const updateData: { name?: string; description?: string; visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' } = {};

      if (name !== undefined) {
        updateData.name = String(name);
      }

      if (description !== undefined) {
        updateData.description = String(description);
      }

      if (visibility !== undefined) {
        updateData.visibility = String(visibility).toUpperCase() as 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
      }

      const pack = await this.stickerPackService.update(id, req.user.id, updateData);
      res.status(200).json(buildSuccessResponse(pack));
    } catch (error) {
      next(error);
    }
  }

  async deleteStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      await this.stickerPackService.delete(id, req.user.id);
      res.status(200).json(buildSuccessResponse({ message: 'Sticker pack deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async addSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { name, filename, url, width, height, fileSize, mimeType, order } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!name || !filename || !url) {
        throw new ValidationError('Name, filename, and URL are required');
      }

      const result = await this.stickerPackService.addSticker({
        stickerPackId: id,
        name: String(name),
        filename: String(filename),
        url: String(url),
        width: width ? Number(width) : undefined,
        height: height ? Number(height) : undefined,
        fileSize: fileSize ? Number(fileSize) : undefined,
        mimeType: mimeType ? String(mimeType) : undefined,
        order: order ? Number(order) : undefined,
      });

      res.status(201).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async removeSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id, stickerId } = req.params;

      if (!id || !stickerId) {
        throw new ValidationError('Sticker pack ID and sticker ID are required');
      }

      await this.stickerPackService.removeSticker(id, stickerId, req.user.id);
      res.status(200).json(buildSuccessResponse({ message: 'Sticker removed from pack successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async reorderStickers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { stickerOrders } = req.body as { stickerOrders: Array<{ stickerId: string; order: number }> };

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!Array.isArray(stickerOrders)) {
        throw new ValidationError('stickerOrders must be an array');
      }

      await this.stickerPackService.reorderStickers(id, req.user.id, stickerOrders);
      res.status(200).json(buildSuccessResponse({ message: 'Stickers reordered successfully' }));
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
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!sharedWithId) {
        throw new ValidationError('User ID is required');
      }

      if (String(sharedWithId) === req.user.id) {
        throw new ValidationError('Cannot share with yourself');
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

      void notificationService.create({
        userId: String(sharedWithId),
        type: 'COLLAB_INVITE',
        title: 'Pack shared with you',
        body: 'You were invited to collaborate on a sticker pack',
        payload: { packId: id, grantedBy: req.user.id, permission: sharePermission },
      });

      res.status(201).json(buildSuccessResponse(share));
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
        throw new ValidationError('Sticker pack ID is required');
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
        throw new ValidationError('Sticker pack ID is required');
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

      res.status(201).json(buildSuccessResponse(this.withPackShareUrl(req, link as Record<string, unknown>)));
    } catch (error) {
      next(error);
    }
  }

  async listCollaborators(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const collaborators = await this.shareService.listCollaborators(id, req.user.id);
      res.status(200).json(buildSuccessResponse(collaborators));
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
        throw new ValidationError('Sticker pack ID is required');
      }

      const links = await this.shareService.listActiveLinks(id, req.user.id);
      res.status(200).json(buildSuccessResponse(links.map((link) => this.withPackShareUrl(req, link as Record<string, unknown>))));
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
        throw new ValidationError('Sticker pack ID is required');
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
