import sharp from 'sharp';
import type { ImageGenerationResult } from '@anvia/core';
import { AIGenerationError, AppError } from '../errors';
import { anviaCore } from '../ai/core';
import { loadAiModel } from '../ai/models/catalog';
import {
  buildReferenceImagesProviderOptions,
  getImagesApiModel,
} from '../ai/provider/images-api-model';

export interface ImageGenerationInput {
  buffer: Buffer;
  mimeType: string;
}

export interface GenerationResult {
  imageBuffer: Buffer;
  metadata: {
    model: string;
    tokensPrompt?: number;
    tokensCompletion?: number;
    cost?: number;
    latencyMs?: number;
  };
}

export class ImageGenerationService {
  private readonly defaultTimeout: number;

  constructor(timeoutMs: number = 60000) {
    this.defaultTimeout = timeoutMs;
  }

  async generateImage(
    prompt: string,
    base64Image?: string,
    imageMimeType: string = 'image/png'
  ): Promise<GenerationResult> {
    const images = base64Image
      ? [{ base64: base64Image, mimeType: imageMimeType }]
      : [];

    return this.generateImageWithInputs(prompt, images);
  }

  async generateImageWithInputs(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }> = []
  ): Promise<GenerationResult> {
    const startedAt = Date.now();
    const { modelId } = await loadAiModel('image');
    const { generateImage } = await anviaCore();

    try {
      const result = await generateImage({
        model: getImagesApiModel(modelId),
        prompt,
        width: 1024,
        height: 1024,
        ...(images.length > 0
          ? { providerOptions: buildReferenceImagesProviderOptions(images) }
          : {}),
        abortSignal: AbortSignal.timeout(this.defaultTimeout),
      });
      return this.toGenerationResult(modelId, result, startedAt);
    } catch (error) {
      // AppErrors (ValidationError config guard, MissingAiModelError, provider
      // taxonomy) keep their own status and message.
      if (error instanceof AppError) {
        throw error;
      }
      throw new AIGenerationError(
        error instanceof Error ? error.message : 'Image generation failed'
      );
    }
  }

  async normalizeGridImage(
    imageBase64: string,
    gridLayout: string,
    targetWidth: number,
    targetHeight: number
  ): Promise<Buffer> {
    const prompt = `You are normalizing a sticker grid image for precise automated splitting.

Task:
- Recreate this grid image as a clean, normalized grid while preserving every original sticker and text.
- Keep the SAME layout: ${gridLayout}.
- Preserve all text labels fully, with complete ascenders/descenders and no clipped edges.
- Make each cell fully visible with safe inner padding so text and faces are never cut.
- Keep each sticker in its own cell only; no overlap between cells.
- Preserve overall style and visual content from the input image.
- Keep clear and consistent gutters between cells.
- Do not crop, zoom-in, or trim any part of any sticker or text.
- Output exactly one complete grid image.
`;

    const { imageBuffer } = await this.generateImage(prompt, imageBase64);

    return sharp(imageBuffer)
      .resize(targetWidth, targetHeight, {
        fit: 'fill',
      })
      .png()
      .toBuffer();
  }

  private toGenerationResult(
    model: string,
    result: ImageGenerationResult<unknown>,
    startedAt: number
  ): GenerationResult {
    const response = result.rawResponse as {
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    return {
      imageBuffer: Buffer.from(result.images[0].data),
      metadata: {
        model,
        tokensPrompt: response.usage?.prompt_tokens,
        tokensCompletion: response.usage?.completion_tokens,
        cost: response.usage?.cost,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}
