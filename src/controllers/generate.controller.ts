import type { Request, Response, NextFunction } from 'express';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { config } from '../config';
import type { ImageResult, GenerationMetadata } from '../types';

export class GenerateController {
  private openRouterService: OpenRouterService;
  private imageService: ImageService;
  private storageService: StorageService;

  constructor() {
    this.openRouterService = new OpenRouterService();
    this.imageService = new ImageService();
    this.storageService = new StorageService();
  }

  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const text = String(body.text ?? '');
      const grid = body.grid === 'true' || body.grid === true;
      const file = req.file;

      let base64Image: string | undefined;
      if (file) {
        base64Image = file.buffer.toString('base64');
      }

      const prompt = `Create a WhatsApp sticker: ${text}`;
      let result: { imageBuffer: Buffer; generationId: string };
      try {
        result = await this.openRouterService.generateImage(prompt, base64Image);
      } catch (error) {
        // If image input fails (provider doesn't support vision), fallback to text-only
        if (base64Image && error instanceof Error && error.message.includes('Provider returned error')) {
          console.warn('Image input not supported by provider, falling back to text-only generation');
          result = await this.openRouterService.generateImage(prompt);
        } else {
          throw error;
        }
      }

      let images: ImageResult[] = [];

      if (grid) {
        const gridResult = await this.openRouterService.detectGridBoundaries(
          result.imageBuffer.toString('base64')
        );
        const splitBuffers = await this.imageService.splitImage(
          result.imageBuffer,
          gridResult.boundaries
        );

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
      } else {
        const filename = await this.storageService.saveFile(result.imageBuffer, 'png');
        const dimensions = await this.imageService.getImageDimensions(result.imageBuffer);
        images.push({
          id: filename.replace('.png', ''),
          url: this.storageService.getPublicUrl(filename),
          width: dimensions.width,
          height: dimensions.height,
        });
      }

      const metadata: GenerationMetadata = {
        model: config.models.imageGeneration,
      };

      if (result.generationId) {
        const genMeta = this.openRouterService.getGenerationMetadata(result.generationId);
        metadata.tokensPrompt = genMeta.tokensPrompt;
        metadata.tokensCompletion = genMeta.tokensCompletion;
        metadata.cost = genMeta.cost;
        metadata.latencyMs = genMeta.latencyMs;
      }

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
