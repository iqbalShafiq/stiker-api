import type { ImageResult } from '../types';
import { OpenRouterService } from './openrouter.service';
import { ImageService } from './image.service';
import { StorageService } from './storage.service';
import { getSegmentationBackgroundRemovalService } from './segmentation-background-removal.service';

export interface GridSplitPipelineOptions {
  normalize?: boolean;
  removeBg?: boolean;
  /** When both set, boundaries match this lattice (same as POST /grid/split with rows+cols). */
  rows?: number;
  cols?: number;
}

export interface GridSplitMetadata {
  gridLayout: string;
  cellCount: number;
  normalizedImageUrl?: string;
  outputSize: string;
  normalized: boolean;
  backgroundRemoved: boolean;
  backgroundRemovalMethod?: string;
}

/**
 * Shared pipeline for POST /api/v1/grid/split and generate(grid=true).
 * Keep behavior identical between both entrypoints.
 */
export class GridSplitService {
  constructor(
    private readonly openRouterService: OpenRouterService,
    private readonly imageService: ImageService,
    private readonly storageService: StorageService
  ) {}

  async split(
    imageBuffer: Buffer,
    options: GridSplitPipelineOptions
  ): Promise<{ images: ImageResult[]; metadata: GridSplitMetadata }> {
    const dimensions = await this.imageService.getImageDimensions(imageBuffer);
    const shouldNormalize = options.normalize ?? false;
    const removeBg = options.removeBg ?? false;
    const rows = options.rows;
    const cols = options.cols;

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

    if (removeBg) {
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

    const splitBuffers = await this.imageService.splitImage(splitSourceBuffer, splitBoundaries);

    const images: ImageResult[] = [];
    for (const buffer of splitBuffers) {
      const squareBuffer = await this.imageService.resizeToSquareContain(buffer, 512);
      const filename = await this.storageService.saveFile(squareBuffer, 'png');
      const cellDimensions = await this.imageService.getImageDimensions(squareBuffer);
      images.push({
        id: filename.replace('.png', ''),
        url: this.storageService.getPublicUrl(filename),
        width: cellDimensions.width,
        height: cellDimensions.height,
      });
    }

    return {
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
    };
  }
}
