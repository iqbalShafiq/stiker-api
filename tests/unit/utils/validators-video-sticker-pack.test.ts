import { describe, expect, it } from 'vitest';
import { generateVideoStickerPackSchema } from '../../../src/utils/validators';

describe('generateVideoStickerPackSchema', () => {
  it('accepts valid multipart body fields and applies defaults', () => {
    const out = generateVideoStickerPackSchema.parse({
      candidateManifest: '[{"candidateId":"f_001"}]',
      selectedStartMs: '12000',
      selectedEndMs: '72000',
      sourceDurationMs: '180000',
      prompt: 'Make expressive WhatsApp stickers',
    });

    expect(out.layout).toBe('4x4');
    expect(out.candidateLayout).toBe('4x4');
    expect(out.selectedStartMs).toBe(12_000);
    expect(out.selectedEndMs).toBe(72_000);
    expect(out.maxStaticStickers).toBe(8);
    expect(out.maxAnimatedStickers).toBe(2);
  });

  it('rejects non-4x4 output layout for MVP', () => {
    expect(() =>
      generateVideoStickerPackSchema.parse({
        candidateManifest: '[]',
        layout: '5x5',
        selectedStartMs: '0',
        selectedEndMs: '30000',
      })
    ).toThrow();
  });

  it('rejects invalid selected range', () => {
    expect(() =>
      generateVideoStickerPackSchema.parse({
        candidateManifest: '[]',
        selectedStartMs: '30000',
        selectedEndMs: '20000',
      })
    ).toThrow('selectedEndMs must be greater than selectedStartMs');
  });

  it('rejects selected end after known source duration', () => {
    expect(() =>
      generateVideoStickerPackSchema.parse({
        candidateManifest: '[]',
        selectedStartMs: '0',
        selectedEndMs: '30000',
        sourceDurationMs: '20000',
      })
    ).toThrow('selectedEndMs cannot exceed sourceDurationMs');
  });
});
