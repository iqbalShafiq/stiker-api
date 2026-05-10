import sharp from 'sharp';
import { config } from '../config';
import { ValidationError } from '../errors';
import { ImageService } from './image.service';
import { getSegmentationBackgroundRemovalService } from './segmentation-background-removal.service';

export interface AnimatedGifRemovalResult {
  processedBuffer: Buffer;
  method: string;
  frameCount: number;
}

function normalizeFrameDelays(delays: number[] | undefined, frameCount: number): number[] {
  if (!delays?.length) {
    return Array.from({ length: frameCount }, () => 100);
  }
  const out: number[] = [...delays];
  const last = delays[delays.length - 1] ?? 100;
  while (out.length < frameCount) {
    out.push(last);
  }
  return out.slice(0, frameCount);
}

export function assertAnimatedGifWithinLimits(
  frameCount: number,
  frameWidth: number,
  frameHeight: number
): void {
  const { maxFrames, maxMegapixelsPerFrame } = config.animatedGif;
  if (frameCount > maxFrames) {
    throw new ValidationError(
      `Animated GIF exceeds maximum frame count (${maxFrames} frames). Reduce frames or split the animation.`
    );
  }
  const megapixels = (frameWidth * frameHeight) / 1_000_000;
  if (megapixels > maxMegapixelsPerFrame) {
    throw new ValidationError(
      `Animated GIF frame size exceeds limit (${maxMegapixelsPerFrame} MP per frame). Resize the source GIF.`
    );
  }
}

/**
 * Remove background from each coalesced GIF frame (IMG.LY), resize to 512×512 contain, re-encode as animated GIF.
 * Falls back to neutral-bright-only keying on **all** frames if IMG.LY fails (lighter on coloured foreground than raw brightness threshold).
 */
export async function removeBackgroundFromAnimatedGif(
  gifBuffer: Buffer
): Promise<AnimatedGifRemovalResult> {
  const animMeta = await sharp(gifBuffer, { animated: true }).metadata();
  const frameCount = animMeta.pages ?? 1;
  const frameWidth = animMeta.width ?? 0;
  const frameHeight =
    animMeta.pageHeight ??
    (frameCount > 0 && animMeta.height ? Math.floor(animMeta.height / frameCount) : 0);

  if (frameCount < 2 || !frameWidth || !frameHeight) {
    throw new ValidationError('Expected an animated GIF with at least two frames');
  }

  assertAnimatedGifWithinLimits(frameCount, frameWidth, frameHeight);

  const delays = normalizeFrameDelays(animMeta.delay, frameCount);
  const loop = typeof animMeta.loop === 'number' ? animMeta.loop : 0;

  const imageService = new ImageService();
  const segmentation = getSegmentationBackgroundRemovalService();

  let method: string;
  let framePngs512: Buffer[];

  try {
    framePngs512 = [];
    for (let page = 0; page < frameCount; page++) {
      const framePng = await sharp(gifBuffer, { page, pages: 1 }).png().toBuffer();
      const removed = await segmentation.remove(framePng);
      let staged = await imageService.reinforceAlphaForGifQuantization(
        removed,
        config.animatedGif.alphaBoostDivisor
      );
      if (config.animatedGif.alphaCloseKernel >= 3) {
        staged = await imageService.morphologicalCloseAlpha(staged, config.animatedGif.alphaCloseKernel);
      }
      staged = await imageService.stripResidualNearCornerBackground(
        framePng,
        staged,
        config.animatedGif.cornerBackgroundStripDistance
      );
      const squared = await imageService.resizeToSquareContain(staged, 512);
      framePngs512.push(squared);
    }
    method = 'imgly-onnx-animated-gif';
  } catch (err) {
    console.warn(
      'IMG.LY background removal failed for animated GIF, falling back to neutral-bright key on all frames:',
      err
    );
    framePngs512 = [];
    for (let page = 0; page < frameCount; page++) {
      const framePng = await sharp(gifBuffer, { page, pages: 1 }).png().toBuffer();
      const removed = await imageService.removeNeutralBrightBackground(framePng);
      const squared = await imageService.resizeToSquareContain(removed, 512);
      framePngs512.push(squared);
    }
    method = 'neutral-bright-fallback-animated-gif';
  }

  const { temporalAlphaMaxHalf, temporalAlphaPasses, temporalDilateAlphaKernel } =
    config.animatedGif;

  framePngs512 =
    framePngs512.length >= 2 && temporalAlphaMaxHalf >= 1
      ? await imageService.stabilizeAnimatedAlphaTemporalCoherence(
          framePngs512,
          temporalAlphaMaxHalf,
          temporalAlphaPasses
        )
      : framePngs512;

  framePngs512 = await Promise.all(
    framePngs512.map((f) => imageService.repairCartoonFlattenedAlpha(f))
  );

  framePngs512 = await Promise.all(
    framePngs512.map((f) =>
      temporalDilateAlphaKernel >= 3
        ? imageService.morphologicalDilateAlpha(f, temporalDilateAlphaKernel)
        : f
    )
  );

  const processedBuffer = await sharp(framePngs512, { join: { animated: true } })
    .gif({
      delay: delays,
      loop,
      dither: config.animatedGif.gifDither,
      colours: 256,
      reuse: config.animatedGif.reusePalette,
      interFrameMaxError: 0,
    })
    .toBuffer();

  return {
    processedBuffer,
    method,
    frameCount,
  };
}
