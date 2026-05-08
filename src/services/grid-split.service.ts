import type { ImageResult } from '../types';
import { OpenRouterService } from './openrouter.service';
import { ImageService } from './image.service';
import { StorageService } from './storage.service';

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
  private static readonly GRID_PREPROCESS_PROMPT =
    'tolong hapuskan background nya tanpa menghilangkan elemen dari gambar dan text di fotonya.';

  private static readonly GRID_PREPROCESS_MODEL = 'google/gemini-2.5-flash-image';
  private static readonly LLM_RETRY_MAX_ATTEMPTS = 3;

  constructor(
    private readonly openRouterService: OpenRouterService,
    private readonly imageService: ImageService,
    private readonly storageService: StorageService
  ) {}

  private async generateImageWithRetry(
    prompt: string,
    sourceBuffer: Buffer,
    model: string
  ): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= GridSplitService.LLM_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.openRouterService.generateImage(
          prompt,
          sourceBuffer.toString('base64'),
          'image/png',
          model,
          false
        );
        return response.imageBuffer;
      } catch (error) {
        lastError = error;
        console.warn(`Grid split LLM attempt ${attempt} failed:`, error);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Grid split LLM failed after maximum retries');
  }

  async split(
    imageBuffer: Buffer,
    options: GridSplitPipelineOptions
  ): Promise<{ images: ImageResult[]; metadata: GridSplitMetadata }> {
    const outputSubDir = options.outputSubDir?.trim() ?? '';

    // Preprocess first with image-edit model to remove backgrounds before any grid analysis.
    const preprocessedBuffer = await this.generateImageWithRetry(
      GridSplitService.GRID_PREPROCESS_PROMPT,
      imageBuffer,
      GridSplitService.GRID_PREPROCESS_MODEL
    );

    const llmBackgroundRemovedFilename = await this.storageService.saveFile(preprocessedBuffer, {
      extension: 'png',
      subDir: outputSubDir,
      baseName: 'llm-bg-removed',
    });
    const llmBackgroundRemovedImageUrl = this.storageService.getPublicUrl(
      llmBackgroundRemovedFilename
    );

    const dimensions = await this.imageService.getImageDimensions(preprocessedBuffer);
    const shouldNormalize = options.normalize ?? false;
    const rows = options.rows;
    const cols = options.cols;

    const initialGridResult =
      rows && cols
        ? await this.openRouterService.detectGridBoundaries(
            preprocessedBuffer.toString('base64'),
            dimensions.width,
            dimensions.height,
            rows,
            cols
          )
        : (await this.imageService.detectGridBoundaries(preprocessedBuffer)) ??
          (await this.openRouterService.detectGridBoundaries(
            preprocessedBuffer.toString('base64'),
            dimensions.width,
            dimensions.height
          ));

    let splitSourceBuffer = preprocessedBuffer;
    let splitBoundaries = initialGridResult.boundaries;
    let gridLayout = initialGridResult.gridLayout;
    let normalizedImageUrl: string | undefined;
    const backgroundRemoved = true;
    const backgroundRemovalMethod = `llm-${GridSplitService.GRID_PREPROCESS_MODEL}`;

    if (shouldNormalize) {
      try {
        const normalizedBuffer = await this.openRouterService.normalizeGridImage(
          preprocessedBuffer.toString('base64'),
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
        console.warn(
          'Grid normalization failed, fallback to original image split:',
          normalizationError
        );
      }
    }

    const splitBuffers = await this.imageService.splitImage(splitSourceBuffer, splitBoundaries);

    const images: ImageResult[] = [];
    for (const [index, buffer] of splitBuffers.entries()) {
      const squareBuffer = await this.imageService.resizeToSquareContain(buffer, 512);
      const filename = await this.storageService.saveFile(squareBuffer, {
        extension: 'png',
        subDir: outputSubDir,
        baseName: `cell-${String(index + 1).padStart(2, '0')}`,
      });
      const cellDimensions = await this.imageService.getImageDimensions(squareBuffer);
      images.push({
        id: filename.split('/').pop()?.replace('.png', '') ?? `cell-${index + 1}`,
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
        llmBackgroundRemovedImageUrl,
        outputSize: '512x512',
        normalized: shouldNormalize && Boolean(normalizedImageUrl),
        backgroundRemoved,
        backgroundRemovalMethod,
      },
    };
  }
}
