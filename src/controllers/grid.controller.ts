import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { GridSplitService } from '../services/grid-split.service';
import { ProcessingHistoryService } from '../services/processing-history.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import { config } from '../config';

export class GridController {
  private gridSplitService: GridSplitService;
  private processingHistoryService: ProcessingHistoryService;

  constructor() {
    const openRouterService = new OpenRouterService();
    const imageService = new ImageService();
    const storageService = new StorageService();
    this.gridSplitService = new GridSplitService(
      openRouterService,
      imageService,
      storageService
    );
    this.processingHistoryService = new ProcessingHistoryService();
  }

  async split(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        throw new ValidationError('Image file is required');
      }

      const imageBuffer = file.buffer;
      const body = req.body as Record<string, unknown>;
      const rows = body.rows ? parseInt(String(body.rows), 10) : undefined;
      const cols = body.cols ? parseInt(String(body.cols), 10) : undefined;
      const shouldNormalize = body.normalize === 'true' || body.normalize === true;
      const requestTimestamp = Date.now();
      const outputSubDir = `grid-split/${requestTimestamp}`;

      const { images, metadata } = await this.gridSplitService.split(imageBuffer, {
        rows,
        cols,
        normalize: shouldNormalize,
        outputSubDir,
      });

      // Log to processing history
      await this.processingHistoryService.create({
        userId: req.user?.id ?? 'anonymous',
        type: 'grid-split',
        inputData: { rows, cols, normalize: shouldNormalize },
        outputFiles: images.map(image => ({
          url: image.url,
          path: image.url.replace(`${config.appUrl}/uploads/`, ''),
          filename: image.id || 'grid-sticker',
          width: image.width,
          height: image.height,
        })),
      });

      res.status(200).json(
        buildSuccessResponse({
          images,
          metadata,
        })
      );
    } catch (error) {
      next(error);
    }
  }
}