import { describe, it, expect } from 'vitest';
import { StickerVisibility } from '@prisma/client';
import {
  hasStickerVisibilityInput,
  parseStickerVisibilityInput,
  parseStickerVisibilityValue,
} from '../../../src/utils/visibility';

describe('visibility utils', () => {
  it('parses visibility strings case-insensitively', () => {
    expect(parseStickerVisibilityValue('public')).toBe(StickerVisibility.PUBLIC);
    expect(parseStickerVisibilityValue('PRIVATE')).toBe(StickerVisibility.PRIVATE);
    expect(parseStickerVisibilityValue('unlisted')).toBe(StickerVisibility.UNLISTED);
    expect(parseStickerVisibilityValue('invalid')).toBeUndefined();
  });

  it('maps isPublic boolean aliases to visibility', () => {
    expect(parseStickerVisibilityInput({ isPublic: true })).toBe(StickerVisibility.PUBLIC);
    expect(parseStickerVisibilityInput({ isPublic: false })).toBe(StickerVisibility.PRIVATE);
    expect(parseStickerVisibilityInput({ public: 'true' })).toBe(StickerVisibility.PUBLIC);
    expect(parseStickerVisibilityInput({ public: 'false' })).toBe(StickerVisibility.PRIVATE);
  });

  it('prefers explicit visibility over isPublic', () => {
    expect(parseStickerVisibilityInput({ visibility: 'private', isPublic: true })).toBe(StickerVisibility.PRIVATE);
  });

  it('detects visibility input presence', () => {
    expect(hasStickerVisibilityInput({ visibility: 'public' })).toBe(true);
    expect(hasStickerVisibilityInput({ isPublic: true })).toBe(true);
    expect(hasStickerVisibilityInput({ name: 'Pack' })).toBe(false);
  });
});
