import { describe, it, expect } from 'vitest';
import { resolveGridRowsCols, tryParseGridLayout } from '../../../src/utils/grid-layout';

describe('grid-layout', () => {
  describe('tryParseGridLayout', () => {
    it('parses 4x4 and Unicode ×', () => {
      expect(tryParseGridLayout('4x4')).toEqual({ rows: 4, cols: 4 });
      expect(tryParseGridLayout(' 3 × 2 ')).toEqual({ rows: 3, cols: 2 });
    });

    it('returns null for invalid strings', () => {
      expect(tryParseGridLayout('')).toBeNull();
      expect(tryParseGridLayout('nope')).toBeNull();
    });
  });

  describe('resolveGridRowsCols', () => {
    it('prefers explicit rows and cols over layout', () => {
      expect(
        resolveGridRowsCols({ rows: 2, cols: 2, layout: '4x4' })
      ).toEqual({ rows: 2, cols: 2 });
    });

    it('falls back to layout when rows/cols incomplete', () => {
      expect(resolveGridRowsCols({ layout: '3x3' })).toEqual({ rows: 3, cols: 3 });
    });

    it('throws when nothing usable is provided', () => {
      expect(() => resolveGridRowsCols({})).toThrow();
    });
  });
});
