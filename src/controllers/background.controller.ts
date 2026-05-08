import type { Request, Response, NextFunction } from 'express';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { getSegmentationBackgroundRemovalService } from '../services/segmentation-background-removal.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError, BackgroundRemovalError } from '../errors';
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
        throw new ValidationError('Image file is required');
      }

      const imageBuffer = file.buffer;

      let processedBuffer: Buffer;
      let method: string;
      try {
        processedBuffer = await getSegmentationBackgroundRemovalService().remove(imageBuffer);
        method = 'imgly-onnx';
      } catch (error) {
        console.warn(
          'IMG.LY background removal failed, falling back to brightness threshold:',
          error
        );
        try {
          processedBuffer = await this.imageService.removeBackground(imageBuffer);
          method = 'brightness-threshold-fallback';
        } catch (fallbackError) {
          throw new BackgroundRemovalError(
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Failed to remove background'
          );
        }
      }

      // Output stays square 512x512 with transparent padding to avoid aspect distortion.
      const squareBuffer = await this.imageService.resizeToSquareContain(processedBuffer, 512);
      const requestTimestamp = Date.now();
      const filename = await this.storageService.saveFile(squareBuffer, {
        extension: 'png',
        subDir: `background-remove/${requestTimestamp}`,
        baseName: 'background-removed',
      });
      const dimensions = await this.imageService.getImageDimensions(squareBuffer);

      const image: ImageResult = {
        id: filename.split('/').pop()?.replace('.png', '') ?? `background-removed-${requestTimestamp}`,
        url: this.storageService.getPublicUrl(filename),
        width: dimensions.width,
        height: dimensions.height,
      };

      res.status(200).json(
        buildSuccessResponse({
          image,
          metadata: {
            method,
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
