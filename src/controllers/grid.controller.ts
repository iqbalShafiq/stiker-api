import type { Request, Response, NextFunction } from 'express';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import type { ImageResult } from '../types';
import { getSegmentationBackgroundRemovalService } from '../services/segmentation-background-removal.service';

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
      const shouldNormalize = body.normalize === 'true' || body.normalize === true;
      const removeBackgroundFromGrid =
        body.removeBg === 'true' || body.removeBg === true;
      
      const initialGridResult =
        rows && cols
          ? await this.openRouterService.detectGridBoundaries(
              imageBuffer.toString('base64'),
              dimensions.width,
              dimensions.height,
              rows,
              cols
            )
          : (await this.imageService.detectGridBoundaries(imageBuffer)) ??
            (await this.openRouterService.detectGridBoundaries(
              imageBuffer.toString('base64'),
              dimensions.width,
              dimensions.height
            ));

      let splitSourceBuffer = imageBuffer;
      let splitBoundaries = initialGridResult.boundaries;
      let gridLayout = initialGridResult.gridLayout;
      let normalizedImageUrl: string | undefined;
      let backgroundRemoved = false;
      let backgroundRemovalMethod: string | undefined;

      if (shouldNormalize) {
        try {
          const normalizedBuffer = await this.openRouterService.normalizeGridImage(
            imageBuffer.toString('base64'),
            initialGridResult.gridLayout,
            dimensions.width,
            dimensions.height
          );

          const normalizedGridResult =
            (await this.imageService.detectGridBoundaries(normalizedBuffer)) ??
            (await this.openRouterService.detectGridBoundaries(
              normalizedBuffer.toString('base64'),
              dimensions.width,
              dimensions.height
            ));

          const normalizedFilename = await this.storageService.saveFile(normalizedBuffer, 'png');
          normalizedImageUrl = this.storageService.getPublicUrl(normalizedFilename);

          splitSourceBuffer = normalizedBuffer;
          splitBoundaries = normalizedGridResult.boundaries;
          gridLayout = normalizedGridResult.gridLayout;
        } catch (normalizationError) {
          console.warn(
            'Grid normalization failed, fallback to original image split:',
            normalizationError
          );
        }
      }

      if (removeBackgroundFromGrid) {
        try {
          splitSourceBuffer = await getSegmentationBackgroundRemovalService().remove(
            splitSourceBuffer
          );
          backgroundRemoved = true;
          backgroundRemovalMethod = 'imgly-onnx';
        } catch (bgError) {
          console.warn(
            'IMG.LY grid background removal failed, falling back to brightness threshold:',
            bgError
          );
          splitSourceBuffer = await this.imageService.removeBackground(splitSourceBuffer);
          backgroundRemoved = true;
          backgroundRemovalMethod = 'brightness-threshold-fallback';
        }
      }

      const splitBuffers = await this.imageService.splitImage(
        splitSourceBuffer,
        splitBoundaries
      );

      const images: ImageResult[] = [];
      for (const buffer of splitBuffers) {
        const squareBuffer = await this.imageService.resizeToSquareContain(buffer, 512);
        const filename = await this.storageService.saveFile(squareBuffer, 'png');
        const dimensions = await this.imageService.getImageDimensions(squareBuffer);
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
            gridLayout,
            cellCount: images.length,
            normalizedImageUrl,
            outputSize: '512x512',
            normalized: shouldNormalize && Boolean(normalizedImageUrl),
            backgroundRemoved,
            backgroundRemovalMethod,
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
