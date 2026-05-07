import { describe, it, expect } from 'vitest';
import { generateImageSchema } from '../../../src/utils/validators';

describe('generateImageSchema grid requirements', () => {
  it('accepts grid with layout only', () => {
    const out = generateImageSchema.parse({
      text: 'hello',
      grid: 'true',
      layout: '2x2',
    });
    expect(out.grid).toBe(true);
    expect(out.layout).toBe('2x2');
  });

  it('accepts grid with rows and cols', () => {
    const out = generateImageSchema.parse({
      text: 'hello',
      grid: true,
      rows: '3',
      cols: '2',
    });
    expect(out.rows).toBe(3);
    expect(out.cols).toBe(2);
  });

  it('rejects grid without layout or rows/cols', () => {
    expect(() =>
      generateImageSchema.parse({
        text: 'hello',
        grid: true,
      })
    ).toThrow();
  });

  it('does not require layout when grid is false', () => {
    const out = generateImageSchema.parse({
      text: 'hello',
      grid: false,
    });
    expect(out.grid).toBe(false);
  });
});
