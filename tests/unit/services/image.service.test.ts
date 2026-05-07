import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ImageService } from '../../../src/services/image.service';
import type { GridBoundary } from '../../../src/types';

describe('ImageService', () => {
  const service = new ImageService();

  describe('getImageDimensions', () => {
    it('should return correct dimensions', async () => {
      const buffer = await sharp({
        create: {
          width: 100,
          height: 200,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const dimensions = await service.getImageDimensions(buffer);
      expect(dimensions.width).toBe(100);
      expect(dimensions.height).toBe(200);
    });
  });

  describe('splitImage', () => {
    it('should split image into multiple parts', async () => {
      const buffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const boundaries: GridBoundary[] = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 100, y: 0, width: 100, height: 100 },
      ];

      const results = await service.splitImage(buffer, boundaries);
      expect(results).toHaveLength(2);

      const dim1 = await service.getImageDimensions(results[0]);
      expect(dim1.width).toBe(100);
      expect(dim1.height).toBe(100);
    });
  });

  describe('removeBackground', () => {
    it('should process image and return buffer', async () => {
      const buffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.removeBackground(buffer);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('resizeImage', () => {
    it('should resize image to specified dimensions', async () => {
      const buffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const resized = await service.resizeImage(buffer, 50, 50);
      const dimensions = await service.getImageDimensions(resized);
      expect(dimensions.width).toBe(50);
      expect(dimensions.height).toBe(50);
    });
  });
});
