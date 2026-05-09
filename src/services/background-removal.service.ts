import { ImageService } from './image.service';
import { getSegmentationBackgroundRemovalService } from './segmentation-background-removal.service';

export interface BackgroundRemovalResult {
  processedBuffer: Buffer;
  method: string;
}

/**
 * Shared non-LLM background-removal pipeline used by /background/remove and grid split post-process.
 */
export async function removeBackgroundWithFallback(
  imageBuffer: Buffer
): Promise<BackgroundRemovalResult> {
  const imageService = new ImageService();

  try {
    const processedBuffer = await getSegmentationBackgroundRemovalService().remove(imageBuffer);
    return {
      processedBuffer,
      method: 'imgly-onnx',
    };
  } catch (error) {
    console.warn('IMG.LY background removal failed, falling back to brightness threshold:', error);
    const processedBuffer = await imageService.removeBackground(imageBuffer);
    return {
      processedBuffer,
      method: 'brightness-threshold-fallback',
    };
  }
}
