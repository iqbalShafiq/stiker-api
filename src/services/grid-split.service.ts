import type { ImageResult } from '../types';
import logger from '../utils/logger';
import {
  OpenRouterService,
  type OutsideForegroundTextDetection,
} from './openrouter.service';
import { ImageService } from './image.service';
import { IStorageProvider } from '../storage/interface';
import { removeBackgroundWithFallback } from './background-removal.service';

export interface GridSplitPipelineOptions {
  normalize?: boolean;
  /** When both set, boundaries match this lattice (same as POST /grid/split with rows+cols). */
  rows?: number;
  cols?: number;
  outputSubDir?: string;
}

export interface GridSplitMetadata {
  gridLayout: string;
  cellCount: number;
  normalizedImageUrl?: string;
  llmBackgroundRemovedImageUrl?: string;
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
    private readonly storageService: IStorageProvider
  ) {}

  async split(
    imageBuffer: Buffer,
    options: GridSplitPipelineOptions
  ): Promise<{ images: ImageResult[]; metadata: GridSplitMetadata }> {
    const outputSubDir = options.outputSubDir?.trim() ?? '';
    const dimensions = await this.imageService.getImageDimensions(imageBuffer);
    const shouldNormalize = options.normalize ?? false;
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
    let backgroundRemovedCellCount = 0;

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
            dimensions.height,
            rows,
            cols
          ));

        const normalizedFilename = await this.storageService.saveFile(normalizedBuffer, {
          extension: 'png',
          subDir: outputSubDir,
          baseName: 'normalized-grid',
        });
        normalizedImageUrl = this.storageService.getPublicUrl(normalizedFilename);

        splitSourceBuffer = normalizedBuffer;
        splitBoundaries = normalizedGridResult.boundaries;
        gridLayout = normalizedGridResult.gridLayout;
      } catch (normalizationError) {
        logger.warn(
          { error: normalizationError },
          'Grid normalization failed, fallback to original image split'
        );
      }
    }

    const splitBuffers = await this.imageService.splitImage(splitSourceBuffer, splitBoundaries);

    const images: ImageResult[] = [];
    const methodsUsed = new Set<string>();
    for (const [index, buffer] of splitBuffers.entries()) {
      const cellId = `cell-${String(index + 1).padStart(2, '0')}`;
      let processedCellBuffer = buffer;
      let textOutsideForeground: ImageResult['textOutsideForeground'];
      try {
        const textAnalysis = await this.analyzeCellTextWithRetry(buffer, cellId);
        const mergedOutsideText = this.mergeOutsideForegroundText(textAnalysis.textOutsideForeground);
        if (mergedOutsideText) {
          textOutsideForeground = {
            text: mergedOutsideText.text,
            style: mergedOutsideText.style,
          };
        }
      } catch (cellTextAnalysisError) {
        logger.warn(
          { error: cellTextAnalysisError },
          `Grid cell text analysis failed for ${cellId}`
        );
      }

      try {
        const result = await removeBackgroundWithFallback(buffer);
        processedCellBuffer = result.processedBuffer;
        methodsUsed.add(result.method);
        backgroundRemovedCellCount += 1;
      } catch (cellBackgroundRemovalError) {
        logger.warn(
          { error: cellBackgroundRemovalError },
          `Grid cell background removal failed for ${cellId}`
        );
      }

      const squareBuffer = await this.imageService.resizeToSquareContain(processedCellBuffer, 512);
      const filename = await this.storageService.saveFile(squareBuffer, {
        extension: 'png',
        subDir: outputSubDir,
        baseName: cellId,
      });
      const cellDimensions = await this.imageService.getImageDimensions(squareBuffer);
      images.push({
        id: filename.split('/').pop()?.replace('.png', '') ?? `cell-${index + 1}`,
        url: this.storageService.getPublicUrl(filename),
        width: cellDimensions.width,
        height: cellDimensions.height,
        ...(textOutsideForeground ? { textOutsideForeground } : {}),
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
        backgroundRemoved: backgroundRemovedCellCount > 0,
        backgroundRemovalMethod:
          methodsUsed.size > 0 ? `post-split:${Array.from(methodsUsed).join('|')}` : undefined,
      },
    };
  }

  private async analyzeCellTextWithRetry(
    buffer: Buffer,
    cellId: string
  ): Promise<ReturnType<OpenRouterService['analyzeCellTextOutsideForeground']>> {
    try {
      return await this.openRouterService.analyzeCellTextOutsideForeground(buffer);
    } catch (firstError) {
      logger.warn(
        { error: firstError },
        `Grid cell text analysis retry for ${cellId} after first failure`
      );
      return this.openRouterService.analyzeCellTextOutsideForeground(buffer);
    }
  }

  private mergeOutsideForegroundText(
    detections: OutsideForegroundTextDetection[]
  ): OutsideForegroundTextDetection | null {
    if (detections.length === 0) {
      return null;
    }

    const mergedText = detections
      .map((item) => item.text.trim())
      .filter((text) => text.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!mergedText) {
      return null;
    }

    return {
      text: mergedText,
      style: detections[0].style,
    };
  }
}
