import type { Request, Response, NextFunction } from 'express';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { GridSplitService } from '../services/grid-split.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import { resolveGridRowsCols } from '../utils/grid-layout';
import { config } from '../config';
import type { ImageResult, GenerationMetadata } from '../types';

/** Ask the model for transparent margins so we avoid server-side matting on /generate. */
const PROMPT_TRANSPARENT_STICKER_BG = `
Visual requirements (critical):
- The sticker subject must have NO rectangular backdrop: use real transparency (alpha) in all areas outside the subject outline.
- Do not paste the artwork on a white, gray, or full-bleed colored panel or “card”.
- The PNG must have meaningful alpha: flat white fills behind the whole image are not acceptable.`;

function buildPromptSingle(text: string): string {
  return `Create a WhatsApp sticker: ${text}
${PROMPT_TRANSPARENT_STICKER_BG}`;
}

function buildPromptGrid(text: string, rows: number, cols: number): string {
  return `Create a WhatsApp sticker GRID SHEET: ${text}

Layout (critical):
- Exactly ${rows} rows and ${cols} columns (${rows * cols} cells total).
- Use straight horizontal and vertical separators (lines or clear gutters) so each cell can be cropped automatically.
- Every cell must contain BOTH:
  1) a clear visual subject (photo-style portrait/object/character), and
  2) a short readable caption text inside the same cell.
- Do not leave any cell without text. Do not place text outside the cell boundaries.
- One distinct sticker per cell; keep all artwork and caption text fully inside its cell with safe margins.

${PROMPT_TRANSPARENT_STICKER_BG}`;
}

export class GenerateController {
  private openRouterService: OpenRouterService;
  private imageService: ImageService;
  private storageService: StorageService;
  private gridSplitService: GridSplitService;

  constructor() {
    this.openRouterService = new OpenRouterService();
    this.imageService = new ImageService();
    this.storageService = new StorageService();
    this.gridSplitService = new GridSplitService(
      this.openRouterService,
      this.imageService,
      this.storageService
    );
  }

  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const text = String(body.text ?? '');
      const grid = Boolean(body.grid);
      const normalize = Boolean(body.normalize);
      const file = req.file;

      if (!text || text.trim().length === 0) {
        throw new ValidationError('Text prompt is required');
      }

      let base64Image: string | undefined;
      let imageMimeType = 'image/png';
      if (file) {
        base64Image = file.buffer.toString('base64');
        if (file.mimetype && /^image\/[a-z0-9.+-]+$/i.test(file.mimetype)) {
          imageMimeType = file.mimetype;
        }
      }

      let prompt: string;
      let gridDims: { rows: number; cols: number } | null = null;

      if (grid) {
        gridDims = resolveGridRowsCols({
          rows: body.rows as number | undefined,
          cols: body.cols as number | undefined,
          layout: body.layout as string | undefined,
        });
        prompt = buildPromptGrid(text, gridDims.rows, gridDims.cols);
      } else {
        prompt = buildPromptSingle(text);
      }

      const { imageBuffer, metadata: aiMetadata } = await this.openRouterService.generateImage(
        prompt,
        base64Image,
        imageMimeType
      );

      let images: ImageResult[] = [];
      const requestTimestamp = Date.now();

      if (grid && gridDims) {
        const { images: gridImages, metadata: gridMeta } = await this.gridSplitService.split(
          imageBuffer,
          {
            rows: gridDims.rows,
            cols: gridDims.cols,
            normalize,
            outputSubDir: `generate-grid/${requestTimestamp}`,
          }
        );
        images = gridImages;

        const metadata: GenerationMetadata = {
          model: config.models.imageGeneration,
          ...aiMetadata,
          gridLayout: gridMeta.gridLayout,
          cellCount: gridMeta.cellCount,
          normalizedImageUrl: gridMeta.normalizedImageUrl,
          outputSize: gridMeta.outputSize,
          normalized: gridMeta.normalized,
          backgroundRemoved: gridMeta.backgroundRemoved,
          backgroundRemovalMethod: gridMeta.backgroundRemovalMethod ?? 'none',
          textOutsideForegroundByCell: gridMeta.textOutsideForegroundByCell,
        };

        res.status(200).json(
          buildSuccessResponse({
            images,
            metadata,
          })
        );
        return;
      }

      // Keep WhatsApp-ready 512x512 output without stretching subject proportions.
      const squareBuffer = await this.imageService.resizeToSquareContain(imageBuffer, 512);
      const filename = await this.storageService.saveFile(squareBuffer, {
        extension: 'png',
        subDir: `generate/${requestTimestamp}`,
        baseName: 'generated-sticker',
      });
      const dimensions = await this.imageService.getImageDimensions(squareBuffer);
      images.push({
        id: filename.split('/').pop()?.replace('.png', '') ?? `generated-sticker-${requestTimestamp}`,
        url: this.storageService.getPublicUrl(filename),
        width: dimensions.width,
        height: dimensions.height,
      });

      const metadata: GenerationMetadata = {
        model: config.models.imageGeneration,
        ...aiMetadata,
        outputSize: '512x512',
        backgroundRemoved: false,
        backgroundRemovalMethod: 'none',
      };

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
