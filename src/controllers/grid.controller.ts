import type { Request, Response, NextFunction } from 'express';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { GridSplitService } from '../services/grid-split.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

export class GridController {
  private gridSplitService: GridSplitService;

  constructor() {
    const openRouterService = new OpenRouterService();
    const imageService = new ImageService();
    const storageService = new StorageService();
    this.gridSplitService = new GridSplitService(
      openRouterService,
      imageService,
      storageService
    );
  }

  async split(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      const removeBackgroundFromGrid =
        body.removeBg === 'true' || body.removeBg === true;

      const { images, metadata } = await this.gridSplitService.split(imageBuffer, {
        rows,
        cols,
        normalize: shouldNormalize,
        removeBg: removeBackgroundFromGrid,
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
