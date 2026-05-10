import sharp from 'sharp';

export type RasterInputKind = 'animated-gif' | 'static';

/**
 * Classify uploaded raster bytes. Animated GIF is detected from container metadata only (no full decode).
 */
export async function classifyRasterInput(buffer: Buffer): Promise<RasterInputKind> {
  const meta = await sharp(buffer).metadata();
  if (meta.format === 'gif' && (meta.pages ?? 1) > 1) {
    return 'animated-gif';
  }
  return 'static';
}
