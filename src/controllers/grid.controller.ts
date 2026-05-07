import type { Request, Response, NextFunction } from 'express';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import type { ImageResult } from '../types';

export class GridController {
  private openRouterService: OpenRouterService;
  private imageService: ImageService;
  private storageService: StorageService;

  constructor() {
    this.openRouterService = new OpenRouterService();
    this.imageService = new ImageService();
    this.storageService = new StorageService();
  }

  async split(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        throw new ValidationError('Image file is required');
      }

      const imageBuffer = file.buffer;
      const dimensions = await this.imageService.getImageDimensions(imageBuffer);
      
      // Allow user to specify rows and cols manually
      const body = req.body as Record<string, unknown>;
      const rows = body.rows ? parseInt(String(body.rows), 10) : undefined;
      const cols = body.cols ? parseInt(String(body.cols), 10) : undefined;
      
      const gridResult = await this.openRouterService.detectGridBoundaries(
        imageBuffer.toString('base64'),
        dimensions.width,
        dimensions.height,
        rows,
        cols
      );

      const splitBuffers = await this.imageService.splitImage(
        imageBuffer,
        gridResult.boundaries
      );

      const images: ImageResult[] = [];
      for (const buffer of splitBuffers) {
        const filename = await this.storageService.saveFile(buffer, 'png');
        const dimensions = await this.imageService.getImageDimensions(buffer);
        images.push({
          id: filename.replace('.png', ''),
          url: this.storageService.getPublicUrl(filename),
          width: dimensions.width,
          height: dimensions.height,
        });
      }

      res.status(200).json(
        buildSuccessResponse({
          images,
          metadata: {
            gridLayout: gridResult.gridLayout,
            cellCount: images.length,
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
