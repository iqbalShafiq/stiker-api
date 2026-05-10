import { describe, it, expect } from 'vitest';
import { assertAnimatedGifWithinLimits } from '../../../src/services/animated-gif-background-removal.service';
import { ValidationError } from '../../../src/errors';

describe('assertAnimatedGifWithinLimits', () => {
  it('allows GIF within default limits', () => {
    expect(() => assertAnimatedGifWithinLimits(50, 500, 345)).not.toThrow();
  });

  it('throws ValidationError when frame count exceeds configured max', () => {
    expect(() => assertAnimatedGifWithinLimits(5000, 10, 10)).toThrow(ValidationError);
  });

  it('throws ValidationError when a single frame exceeds megapixel cap', () => {
    expect(() => assertAnimatedGifWithinLimits(2, 4500, 4500)).toThrow(ValidationError);
  });
});
