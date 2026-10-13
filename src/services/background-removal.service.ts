import logger from '../utils/logger';
import { BackgroundRemovalError } from '../errors';
import { getSegmentationBackgroundRemovalService } from './segmentation-background-removal.service';

export interface BackgroundRemovalResult {
  processedBuffer: Buffer;
  method: string;
}

/** IMG.LY segmentation only — failures surface instead of degrading to a crude local threshold. */
export async function removeBackground(imageBuffer: Buffer): Promise<BackgroundRemovalResult> {
  try {
    const processedBuffer = await getSegmentationBackgroundRemovalService().remove(imageBuffer);
    return { processedBuffer, method: 'imgly-onnx' };
  } catch (error) {
    logger.error({ error }, 'IMG.LY background removal failed');
    throw new BackgroundRemovalError(
      error instanceof Error
        ? `Background removal failed: ${error.message}`
        : 'Background removal failed'
    );
  }
}
