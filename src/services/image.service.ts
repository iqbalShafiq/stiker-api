import sharp from 'sharp';
import type { GridBoundary } from '../types';

export class ImageService {
  async getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
    };
  }

  async splitImage(buffer: Buffer, boundaries: GridBoundary[]): Promise<Buffer[]> {
    const results: Buffer[] = [];

    for (const boundary of boundaries) {
      const cropped = await sharp(buffer)
        .extract({
          left: Math.round(boundary.x),
          top: Math.round(boundary.y),
          width: Math.round(boundary.width),
          height: Math.round(boundary.height),
        })
        .png()
        .toBuffer();

      results.push(cropped);
    }

    return results;
  }

  async removeBackground(buffer: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const threshold = 240;
    const newData = Buffer.from(data);

    for (let i = 0; i < newData.length; i += 4) {
      const r = newData[i];
      const g = newData[i + 1];
      const b = newData[i + 2];

      if (r > threshold && g > threshold && b > threshold) {
        newData[i + 3] = 0;
      }
    }

    return sharp(newData, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  async resizeImage(buffer: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(buffer)
      .resize(width, height, { fit: 'cover' })
      .png()
      .toBuffer();
  }

  async convertToPng(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).png().toBuffer();
  }
}
