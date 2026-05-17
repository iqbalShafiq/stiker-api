import type { Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { LocalStorageProvider } from '../storage/local.provider';
import { ProcessingHistoryService } from '../services/processing-history.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import { resolveGridRowsCols } from '../utils/grid-layout';
import {
  chunkImageInputs,
  IMPROVEMENT_GRID_LAYOUT,
  IMPROVEMENT_GRID_MAX_CELLS,
  type ImageGenerationInput,
} from '../utils/improvement';
import {
  buildEmptyTextAssetDecoration,
} from '../utils/text-asset-decoration';
import { config } from '../config';
import type { ImageResult, GenerationMetadata } from '../types';
import type { AuthRequest } from '../middleware/auth.middleware';

type AiMetadata = Pick<
  GenerationMetadata,
  'tokensPrompt' | 'tokensCompletion' | 'cost' | 'latencyMs'
>;

interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
}

/** Ask the model for transparent margins so we avoid server-side matting on /generate. */
const PROMPT_TRANSPARENT_STICKER_BG = `
Visual requirements (critical):
- The sticker subject must have NO rectangular backdrop: use real transparency (alpha) in all areas outside the subject outline.
- Do not paste the artwork on a white, gray, or full-bleed colored panel or "card".
- The PNG must have meaningful alpha: flat white fills behind the whole image are not acceptable.`;

function buildPromptSingle(text: string): string {
  return `Create a WhatsApp sticker: ${text}

Text requirement (critical):
- Include one short, readable caption text in the sticker.
- Keep caption high-contrast against the background and subject.
- Keep text fully visible and not clipped.
${PROMPT_TRANSPARENT_STICKER_BG}`;
}

function buildPromptStickerPack(text: string, rows: number, cols: number): string {
  return `Create one complete WhatsApp sticker pack GRID SHEET: ${text}

Layout (critical):
- Exactly ${rows} rows and ${cols} columns (${rows * cols} cells total).
- Output exactly one square grid image, not separate files.
- Use clear gutters or separators so every cell reads as a distinct sticker.
- Every cell must contain BOTH:
  1) one clear sticker subject, and
  2) one short readable caption text inside the same cell.
- Do not leave any cell empty.
- Keep every subject and caption fully inside its cell with safe margins.
- No clipped text, no cropped faces, no overlap between cells.

Contrast (critical):
- Choose each cell background to contrast strongly with its subject and caption text.
- Caption text must remain readable at small size.
- Avoid text colors that blend into background or image subjects.
- Use subtle outlines or shadows only when they improve readability.

Style:
- Cohesive pack style across all cells.
- Sticker-ready, polished, expressive, and clean.`;
}

function buildGridImprovementGenerationPrompt(agentPrompt: string, inputCount: number): string {
  return `${agentPrompt}

Hard output requirements:
- Output one square 4x4 grid image.
- Use ONLY the ${inputCount} provided input stickers. Do not invent extra stickers.
- If fewer than 16 stickers are provided, leave unused cells clean/empty or neutral.
- Preserve one improved sticker concept per provided input image.
- Keep clear gutters/separators and safe margins.
- Ensure each used cell has one short readable caption text.
- Keep all caption text readable and fully inside cells.
- Improve contrast between subject, text, and background.`;
}

function buildSingleImprovementGenerationPrompt(
  agentPrompt: string,
  hasTextAssetDecoration: boolean
): string {
  if (!hasTextAssetDecoration) {
    return agentPrompt;
  }

  return `${agentPrompt}

Hard output requirement:
- Do NOT render the detected decorative text in the image.
- Keep the sticker art clean; the client will render the text separately from textAssetDecoration.`;
}

function mergeAiMetadata(items: AiMetadata[]): AiMetadata {
  return items.reduce<AiMetadata>((merged, item) => ({
    tokensPrompt: sumOptional(merged.tokensPrompt, item.tokensPrompt),
    tokensCompletion: sumOptional(merged.tokensCompletion, item.tokensCompletion),
    cost: sumOptional(merged.cost, item.cost),
    latencyMs: sumOptional(merged.latencyMs, item.latencyMs),
  }), {});
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left == null && right == null) {
    return undefined;
  }
  return (left ?? 0) + (right ?? 0);
}

export class GenerateController {
  private openRouterService: OpenRouterService;
  private imageService: ImageService;
  private storageProvider: LocalStorageProvider;
  private processingHistoryService: ProcessingHistoryService;

  constructor() {
    this.openRouterService = new OpenRouterService();
    this.imageService = new ImageService();
    this.storageProvider = new LocalStorageProvider();
    this.processingHistoryService = new ProcessingHistoryService();
  }

  async generate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const body = req.body as Record<string, unknown>;
      const text = String(body.text ?? '').trim();
      const file = req.file;

      if (!text) {
        throw new ValidationError('Text prompt is required');
      }

      const inputImages = file ? [this.fileToImageInput(file)] : [];
      const { imageBuffer, metadata: aiMetadata } =
        await this.openRouterService.generateImageWithInputs(
          buildPromptSingle(text),
          this.toBase64Inputs(inputImages)
        );

      const requestTimestamp = Date.now();
      const imageResult = await this.saveGeneratedImage({
        imageBuffer,
        userId,
        subDir: `generate/${requestTimestamp}`,
        baseName: 'generated-sticker',
      });
      imageResult.textAssetDecoration = buildEmptyTextAssetDecoration('input', text);

      await this.recordGenerateHistory(userId, {
        inputData: { text, mode: 'single', inputImage: Boolean(file) },
        images: [imageResult],
      });

      const metadata: GenerationMetadata = {
        model: config.models.imageGeneration,
        ...aiMetadata,
        mode: 'single',
        inputCount: inputImages.length,
        outputCount: 1,
        outputSize: '512x512',
        backgroundRemoved: false,
        backgroundRemovalMethod: 'none',
      };

      res.status(200).json(buildSuccessResponse({ images: [imageResult], metadata }));
    } catch (error) {
      next(error);
    }
  }

  async generateStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const body = req.body as Record<string, unknown>;
      const text = String(body.text ?? '').trim();
      const gridDims = resolveGridRowsCols({
        rows: body.rows as number | undefined,
        cols: body.cols as number | undefined,
        layout: body.layout as string | undefined,
      });
      const inputImages = req.file ? [this.fileToImageInput(req.file)] : [];

      if (!text) {
        throw new ValidationError('Text prompt is required');
      }

      const { imageBuffer, metadata: aiMetadata } =
        await this.openRouterService.generateImageWithInputs(
          buildPromptStickerPack(text, gridDims.rows, gridDims.cols),
          this.toBase64Inputs(inputImages)
        );

      const requestTimestamp = Date.now();
      const imageResult = await this.saveGeneratedImage({
        imageBuffer,
        userId,
        subDir: `generate-sticker-pack/${requestTimestamp}`,
        baseName: 'generated-sticker-pack',
      });
      imageResult.textAssetDecoration = buildEmptyTextAssetDecoration(
        'detected',
        'Captions embedded per cell in grid image'
      );

      await this.recordGenerateHistory(userId, {
        inputData: {
          text,
          mode: 'sticker-pack',
          rows: gridDims.rows,
          cols: gridDims.cols,
          inputImage: Boolean(req.file),
        },
        images: [imageResult],
      });

      const metadata: GenerationMetadata = {
        model: config.models.imageGeneration,
        ...aiMetadata,
        gridLayout: `${gridDims.rows}x${gridDims.cols}`,
        cellCount: gridDims.rows * gridDims.cols,
        outputSize: '512x512',
        backgroundRemoved: false,
        backgroundRemovalMethod: 'none',
      };

      res.status(200).json(buildSuccessResponse({ images: [imageResult], metadata }));
    } catch (error) {
      next(error);
    }
  }

  async improve(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        throw new ValidationError('At least one image file is required');
      }

      const inputImages = files.map(file => this.fileToImageInput(file));
      const requestTimestamp = Date.now();

      if (inputImages.length === 1) {
        const agent = await this.openRouterService.buildImprovementPrompt(inputImages, 'single');
        const { imageBuffer, metadata: aiMetadata } =
          await this.openRouterService.generateImageWithInputs(
            buildSingleImprovementGenerationPrompt(
              agent.plan.improvementPrompt,
              Boolean(agent.plan.textAssetDecoration)
            ),
            this.toBase64Inputs(inputImages),
            config.models.imageGeneration,
            false
          );
        const imageResult = await this.saveGeneratedImage({
          imageBuffer,
          userId,
          subDir: `generate-improvement/${requestTimestamp}`,
          baseName: 'improved-sticker',
        });

        imageResult.textAssetDecoration =
          agent.plan.textAssetDecoration ??
          buildEmptyTextAssetDecoration('detected', 'Improved caption');

        await this.recordGenerateHistory(userId, {
          inputData: { mode: 'improvement-single', inputCount: 1 },
          images: [imageResult],
        });

        const metadata: GenerationMetadata = {
          model: config.models.imageGeneration,
          improvementAgentModel: config.models.improvementAgent,
          ...mergeAiMetadata([agent.metadata, aiMetadata]),
          mode: 'single',
          inputCount: 1,
          outputCount: 1,
          outputSize: '512x512',
          backgroundRemoved: false,
          backgroundRemovalMethod: 'none',
        };

        res.status(200).json(buildSuccessResponse({ images: [imageResult], metadata }));
        return;
      }

      const chunks = chunkImageInputs(inputImages, IMPROVEMENT_GRID_MAX_CELLS);
      const images: ImageResult[] = [];
      const metadataParts: AiMetadata[] = [];

      for (const [chunkIndex, chunk] of chunks.entries()) {
        const agent = await this.openRouterService.buildImprovementPrompt(chunk, 'grid');
        metadataParts.push(agent.metadata);

        const { imageBuffer, metadata: aiMetadata } =
          await this.openRouterService.generateImageWithInputs(
            buildGridImprovementGenerationPrompt(agent.plan.improvementPrompt, chunk.length),
            this.toBase64Inputs(chunk),
            config.models.imageGeneration,
            false
          );
        metadataParts.push(aiMetadata);

        const imageResult = await this.saveGeneratedImage({
          imageBuffer,
          userId,
          subDir: `generate-improvement/${requestTimestamp}`,
          baseName: `improved-grid-${String(chunkIndex + 1).padStart(2, '0')}`,
        });
        imageResult.textAssetDecoration = buildEmptyTextAssetDecoration(
          'detected',
          'Captions embedded per used cell in grid image'
        );
        images.push(imageResult);
      }

      await this.recordGenerateHistory(userId, {
        inputData: {
          mode: 'improvement-grid',
          inputCount: inputImages.length,
          gridLayout: IMPROVEMENT_GRID_LAYOUT,
          maxCellsPerImage: IMPROVEMENT_GRID_MAX_CELLS,
        },
        images,
      });

      const metadata: GenerationMetadata = {
        model: config.models.imageGeneration,
        improvementAgentModel: config.models.improvementAgent,
        ...mergeAiMetadata(metadataParts),
        mode: 'grid',
        inputCount: inputImages.length,
        outputCount: images.length,
        gridLayout: IMPROVEMENT_GRID_LAYOUT,
        maxCellsPerImage: IMPROVEMENT_GRID_MAX_CELLS,
        outputSize: '512x512',
        backgroundRemoved: false,
        backgroundRemovalMethod: 'none',
      };

      res.status(200).json(buildSuccessResponse({ images, metadata }));
    } catch (error) {
      next(error);
    }
  }

  private requireUserId(req: AuthRequest): string {
    const userId = req.user?.id;
    if (!userId) {
      throw new ValidationError('Authentication required');
    }
    return userId;
  }

  private fileToImageInput(file: UploadedImageFile): ImageGenerationInput {
    return {
      buffer: file.buffer,
      mimeType: file.mimetype && /^image\/[a-z0-9.+-]+$/i.test(file.mimetype)
        ? file.mimetype
        : 'image/png',
    };
  }

  private toBase64Inputs(
    images: ImageGenerationInput[]
  ): Array<{ base64: string; mimeType: string }> {
    return images.map(image => ({
      base64: image.buffer.toString('base64'),
      mimeType: image.mimeType,
    }));
  }

  private async saveGeneratedImage(input: {
    imageBuffer: Buffer;
    userId: string;
    subDir: string;
    baseName: string;
  }): Promise<ImageResult> {
    const squareBuffer = await this.imageService.resizeToSquareContain(input.imageBuffer, 512);
    const uniqueBaseName = `${input.baseName}-${randomUUID()}`;
    const filename = await this.storageProvider.saveFile(squareBuffer, {
      extension: 'png',
      subDir: input.subDir,
      baseName: uniqueBaseName,
      ownerId: input.userId,
    });
    const dimensions = await this.imageService.getImageDimensions(squareBuffer);

    return {
      id: filename.split('/').pop()?.replace('.png', '') ?? `${input.baseName}-${Date.now()}`,
      url: this.storageProvider.getPublicUrl(filename),
      width: dimensions.width,
      height: dimensions.height,
    };
  }

  private async recordGenerateHistory(
    userId: string,
    input: {
      inputData: Record<string, unknown>;
      images: ImageResult[];
    }
  ): Promise<void> {
    await this.processingHistoryService.create({
      userId,
      type: 'generate',
      inputData: input.inputData,
      outputFiles: input.images.map(image => ({
        url: image.url,
        path: image.url.replace(`${config.appUrl}/uploads/`, ''),
        filename: image.id || 'generated-sticker',
        width: image.width,
        height: image.height,
      })),
    });
  }
}
