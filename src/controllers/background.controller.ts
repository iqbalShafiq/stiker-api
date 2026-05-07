import type { Request, Response, NextFunction } from 'express';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { buildSuccessResponse } from '../utils/response-builder';
import type { ImageResult } from '../types';

export class BackgroundController {
  private imageService: ImageService;
  private storageService: StorageService;

  constructor() {
    this.imageService = new ImageService();
    this.storageService = new StorageService();
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        throw new Error('VALIDATION_ERROR: Image file is required');
      }

      const imageBuffer = file.buffer;
      const processedBuffer = await this.imageService.removeBackground(imageBuffer);

      const filename = await this.storageService.saveFile(processedBuffer, 'png');
      const dimensions = await this.imageService.getImageDimensions(processedBuffer);

      const image: ImageResult = {
        id: filename.replace('.png', ''),
        url: this.storageService.getPublicUrl(filename),
        width: dimensions.width,
        height: dimensions.height,
      };

      res.status(200).json(
        buildSuccessResponse({
          image,
          metadata: {},
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
