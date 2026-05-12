import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import sharp from 'sharp';
import { removeBackgroundFromAnimatedGif } from '../services/animated-gif-background-removal.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { removeBackgroundWithFallback } from '../services/background-removal.service';
import { ProcessingHistoryService } from '../services/processing-history.service';
import { classifyRasterInput } from '../utils/image-input-classifier';
import { buildSuccessResponse } from '../utils/response-builder';
import { AppError, ValidationError, BackgroundRemovalError } from '../errors';
import type { ImageResult } from '../types';
import { config } from '../config';

function fileIdFromUploadedPath(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  return base.replace(/\.[^/.]+$/, '');
}

export class BackgroundController {
  private imageService: ImageService;
  private storageService: StorageService;
  private processingHistoryService: ProcessingHistoryService;

  constructor() {
    this.imageService = new ImageService();
    this.storageService = new StorageService();
    this.processingHistoryService = new ProcessingHistoryService();
  }

  async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        throw new ValidationError('Image file is required');
      }

      const imageBuffer = file.buffer;
      const requestTimestamp = Date.now();
      const subDir = `background-remove/${requestTimestamp}`;

      const kind = await classifyRasterInput(imageBuffer);

      if (kind === 'animated-gif') {
        let processedBuffer: Buffer;
        let method: string;
        let frameCount: number;
        try {
          const gifResult = await removeBackgroundFromAnimatedGif(imageBuffer);
          processedBuffer = gifResult.processedBuffer;
          method = gifResult.method;
          frameCount = gifResult.frameCount;
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          throw new BackgroundRemovalError(
            error instanceof Error ? error.message : 'Failed to remove background from GIF'
          );
        }

        const dimensions = await sharp(processedBuffer, { animated: true }).metadata();
        const filename = await this.storageService.saveFile(processedBuffer, {
          extension: 'gif',
          subDir,
          baseName: 'background-removed',
        });

        const image: ImageResult = {
          id: fileIdFromUploadedPath(filename),
          url: this.storageService.getPublicUrl(filename),
          width: dimensions.width ?? 512,
          height: dimensions.pageHeight ?? dimensions.height ?? 512,
        };

        // Log to processing history
        await this.processingHistoryService.create({
          userId: req.user?.id ?? 'anonymous',
          type: 'background-remove',
          inputData: { kind: 'animated-gif' },
          outputFiles: [{
            url: image.url,
            path: image.url.replace(`${config.appUrl}/uploads/`, ''),
            filename: image.id,
            width: image.width,
            height: image.height,
          }],
        });

        res.status(200).json(
          buildSuccessResponse({
            image,
            metadata: {
              method,
              frameCount,
              outputFormat: 'gif',
            },
          })
        );
        return;
      }

      let processedBuffer: Buffer;
      let method: string;
      try {
        const result = await removeBackgroundWithFallback(imageBuffer);
        processedBuffer = result.processedBuffer;
        method = result.method;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw new BackgroundRemovalError(
          error instanceof Error ? error.message : 'Failed to remove background'
        );
      }

      const squareBuffer = await this.imageService.resizeToSquareContain(processedBuffer, 512);
      const filename = await this.storageService.saveFile(squareBuffer, {
        extension: 'png',
        subDir,
        baseName: 'background-removed',
      });
      const dimensions = await this.imageService.getImageDimensions(squareBuffer);

      const image: ImageResult = {
        id: fileIdFromUploadedPath(filename),
        url: this.storageService.getPublicUrl(filename),
        width: dimensions.width,
        height: dimensions.height,
      };

      // Log to processing history
      await this.processingHistoryService.create({
        userId: req.user?.id ?? 'anonymous',
        type: 'background-remove',
        inputData: { kind: 'static-image' },
        outputFiles: [{
          url: image.url,
          path: image.url.replace(`${config.appUrl}/uploads/`, ''),
          filename: image.id,
          width: image.width,
          height: image.height,
        }],
      });

      res.status(200).json(
        buildSuccessResponse({
          image,
          metadata: {
            method,
            outputFormat: 'png',
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }
}