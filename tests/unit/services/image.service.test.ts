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

  describe('detectGridBoundaries', () => {
    it('should detect boundaries from a simple 2x2 grid with white separators', async () => {
      const width = 220;
      const height = 220;
      const separator = 10;
      const cell = 100;
      const channels = 3;
      const raw = Buffer.alloc(width * height * channels, 255);

      for (let y = separator; y < separator + cell; y++) {
        for (let x = separator; x < separator + cell; x++) {
          const idx = (y * width + x) * channels;
          raw[idx] = 200;
          raw[idx + 1] = 30;
          raw[idx + 2] = 30;
        }
      }

      for (let y = separator; y < separator + cell; y++) {
        for (let x = separator * 2 + cell; x < separator * 2 + cell * 2; x++) {
          const idx = (y * width + x) * channels;
          raw[idx] = 30;
          raw[idx + 1] = 200;
          raw[idx + 2] = 30;
        }
      }

      for (let y = separator * 2 + cell; y < separator * 2 + cell * 2; y++) {
        for (let x = separator; x < separator + cell; x++) {
          const idx = (y * width + x) * channels;
          raw[idx] = 30;
          raw[idx + 1] = 30;
          raw[idx + 2] = 200;
        }
      }

      for (let y = separator * 2 + cell; y < separator * 2 + cell * 2; y++) {
        for (let x = separator * 2 + cell; x < separator * 2 + cell * 2; x++) {
          const idx = (y * width + x) * channels;
          raw[idx] = 120;
          raw[idx + 1] = 120;
          raw[idx + 2] = 30;
        }
      }

      const buffer = await sharp(raw, {
        raw: { width, height, channels },
      })
        .png()
        .toBuffer();

      const result = await service.detectGridBoundaries(buffer);
      expect(result).not.toBeNull();
      expect(result?.gridLayout).toBe('2x2');
      expect(result?.boundaries).toHaveLength(4);
      expect(result?.boundaries[0]).toEqual({
        x: 0,
        y: 0,
        width: 111,
        height: 111,
      });
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

  describe('removeNeutralBrightBackground', () => {
    it('clears near-white neutral but keeps saturated bright colours', async () => {
      const buffer = await sharp({
        create: {
          width: 4,
          height: 1,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .composite([
          { input: { create: { width: 1, height: 1, channels: 4, background: { r: 250, g: 250, b: 250, alpha: 1 } } }, left: 0, top: 0 },
          { input: { create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 240, b: 240, alpha: 1 } } }, left: 1, top: 0 },
          { input: { create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 200, b: 200, alpha: 1 } } }, left: 2, top: 0 },
          { input: { create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }, left: 3, top: 0 },
        ])
        .png()
        .toBuffer();

      const result = await service.removeNeutralBrightBackground(buffer);
      const { data } = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const a0 = data[3];
      const a1 = data[7];
      const a3 = data[15];
      expect(a0).toBe(0);
      expect(a1).toBe(0);
      expect(a3).toBe(255);
    });
  });

  describe('reinforceAlphaForGifQuantization', () => {
    it('increases partial alpha', async () => {
      const buffer = await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 4,
          background: { r: 100, g: 100, b: 100, alpha: 0.4 },
        },
      })
        .png()
        .toBuffer();

      const out = await service.reinforceAlphaForGifQuantization(buffer, 0.9);
      const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(data[3]).toBeGreaterThan(100);
      expect(data[3]).toBeLessThanOrEqual(255);
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
