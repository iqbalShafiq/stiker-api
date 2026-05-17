import { describe, it, expect } from 'vitest';
import {
  generateImageSchema,
  generateStickerPackSchema,
} from '../../../src/utils/validators';

describe('generate schemas', () => {
  it('accepts single sticker generate text', () => {
    const out = generateImageSchema.parse({
      text: 'hello',
    });
    expect(out.text).toBe('hello');
  });

  it('rejects legacy grid fields on single sticker generate', () => {
    expect(() =>
      generateImageSchema.parse({
        text: 'hello',
        grid: 'true',
      })
    ).toThrow();
  });

  it('accepts sticker pack with layout only', () => {
    const out = generateStickerPackSchema.parse({
      text: 'hello',
      layout: '2x2',
    });
    expect(out.layout).toBe('2x2');
  });

  it('accepts sticker pack with rows and cols', () => {
    const out = generateStickerPackSchema.parse({
      text: 'hello',
      rows: '3',
      cols: '2',
    });
    expect(out.rows).toBe(3);
    expect(out.cols).toBe(2);
  });

  it('rejects sticker pack without layout or rows/cols', () => {
    expect(() =>
      generateStickerPackSchema.parse({
        text: 'hello',
      })
    ).toThrow();
  });
});
