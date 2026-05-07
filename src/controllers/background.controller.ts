import type { Request, Response, NextFunction } from 'express';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { StorageService } from '../services/storage.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError, BackgroundRemovalError } from '../errors';
import type { ImageResult } from '../types';

export class BackgroundController {
  private openRouterService: OpenRouterService;
  private imageService: ImageService;
  private storageService: StorageService;

  constructor() {
    this.openRouterService = new OpenRouterService();
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
      const base64Image = imageBuffer.toString('base64');

      // Gunakan AI untuk generate gambar tanpa background
      const prompt = 'Hapus background dari gambar ini, buat background menjadi transparan. Pertahankan subjek utama dengan jelas. Hasilkan dalam format PNG dengan alpha channel.';
      
      let processedBuffer: Buffer;
      try {
        const result = await this.openRouterService.generateImage(prompt, base64Image);
        processedBuffer = result.imageBuffer;
      } catch (error) {
        // Fallback ke image processing lokal jika AI gagal
        console.warn('AI background removal failed, falling back to local processing:', error);
        try {
          processedBuffer = await this.imageService.removeBackground(imageBuffer);
        } catch (fallbackError) {
          throw new BackgroundRemovalError(
            fallbackError instanceof Error 
              ? fallbackError.message 
              : 'Failed to remove background'
          );
        }
      }

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
