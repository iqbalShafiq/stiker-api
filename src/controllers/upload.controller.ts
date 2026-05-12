import type { Response, NextFunction } from 'express';
import { StickerService } from '../services/sticker.service';
import { StickerPackService } from '../services/sticker-pack.service';
import { LocalStorageProvider } from '../storage/local.provider';
import { ImageService } from '../services/image.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import { StickerVisibility } from '@prisma/client';

export class UploadController {
  private stickerService: StickerService;
  private stickerPackService: StickerPackService;
  private storageProvider: LocalStorageProvider;
  private imageService: ImageService;

  constructor() {
    this.stickerService = new StickerService();
    this.stickerPackService = new StickerPackService();
    this.storageProvider = new LocalStorageProvider();
    this.imageService = new ImageService();
  }

  async upload(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('Authentication required');
      }

      const userId = req.user.id;
      // eslint-disable-next-line no-undef
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        throw new ValidationError('At least one image file is required');
      }

      const body = req.body as Record<string, unknown>;
      const stickerPackId = body.stickerPackId ? String(body.stickerPackId) : undefined;
      const stickerPackName = body.stickerPackName ? String(body.stickerPackName) : undefined;
      const stickerPackDescription = body.stickerPackDescription ? String(body.stickerPackDescription) : undefined;
      const visibility = String(body.visibility ?? 'private').toUpperCase() as StickerVisibility;
      const existingStickerIds = body.existingStickerIds ? JSON.parse(String(body.existingStickerIds)) as string[] : [];

      let packId = stickerPackId;

      // Create new sticker pack if name provided but no ID
      if (!packId && stickerPackName) {
        const pack = await this.stickerPackService.create({
          ownerId: userId,
          name: stickerPackName,
          description: stickerPackDescription,
          visibility,
        });
        packId = pack.id;
      }

      const uploadedStickers = [];
      const requestTimestamp = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const squareBuffer = await this.imageService.resizeToSquareContain(file.buffer, 512);
        const filename = await this.storageProvider.saveFile(squareBuffer, {
          extension: 'png',
          subDir: `uploads/${requestTimestamp}`,
          baseName: `sticker-${i}`,
          ownerId: userId,
        });
        const dimensions = await this.imageService.getImageDimensions(squareBuffer);
        const url = this.storageProvider.getPublicUrl(filename);

        const sticker = await this.stickerService.create({
          ownerId: userId,
          name: file.originalname.replace(/\.[^/.]+$/, '') || `sticker-${i}`,
          filename,
          url,
          width: dimensions.width,
          height: dimensions.height,
          fileSize: file.size,
          mimeType: 'image/png',
          visibility,
        });

        uploadedStickers.push(sticker);

        // Add to sticker pack if packId exists
        if (packId) {
          await this.stickerPackService.addSticker({
            stickerPackId: packId,
            name: sticker.name,
            filename: sticker.filename,
            url: sticker.url,
            width: sticker.width ?? undefined,
            height: sticker.height ?? undefined,
            fileSize: sticker.fileSize ?? undefined,
            mimeType: sticker.mimeType ?? undefined,
            order: i,
          });
        }
      }

      // Handle existing sticker IDs (add to pack)
      if (packId && existingStickerIds.length > 0) {
        for (const existingId of existingStickerIds) {
          const existingSticker = await this.stickerService.findById(existingId);
          if (existingSticker) {
            await this.stickerPackService.addSticker({
              stickerPackId: packId,
              name: existingSticker.name,
              filename: existingSticker.filename,
              url: existingSticker.url,
              width: existingSticker.width ?? undefined,
              height: existingSticker.height ?? undefined,
              fileSize: existingSticker.fileSize ?? undefined,
              mimeType: existingSticker.mimeType ?? undefined,
            });
          }
        }
      }

      res.status(201).json(buildSuccessResponse({
        stickerPackId: packId,
        stickers: uploadedStickers,
        message: 'Stickers uploaded successfully',
      }));
    } catch (error) {
      next(error);
    }
  }
}