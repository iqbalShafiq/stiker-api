import { describe, expect, it } from 'vitest';
import { generateVideoStickerPackSchema } from '../../../src/utils/validators';

describe('generateVideoStickerPackSchema', () => {
  it('accepts valid multipart body fields', () => {
    const out = generateVideoStickerPackSchema.parse({
      layout: '4x4',
      candidateLayout: '4x4',
      candidateCount: '32',
      selectedStartMs: '12000',
      selectedEndMs: '72000',
      sourceDurationMs: '180000',
      prompt: 'Make expressive WhatsApp stickers',
    });

    expect(out.candidateCount).toBe(32);
    expect(out.selectedStartMs).toBe(12_000);
    expect(out.selectedEndMs).toBe(72_000);
    expect(out.layout).toBe('4x4');
    expect(out.candidateLayout).toBe('4x4');
    expect(out.prompt).toBe('Make expressive WhatsApp stickers');
  });

  it('accepts selected segment exactly 60000 ms', () => {
    const out = generateVideoStickerPackSchema.parse({
      layout: '4x4',
      candidateLayout: '4x4',
      candidateCount: '16',
      selectedStartMs: '1000',
      selectedEndMs: '61000',
    });

    expect(out.selectedEndMs - out.selectedStartMs).toBe(60_000);
  });

  it('rejects selected segment longer than 60000 ms with targeted issue', () => {
    const result = generateVideoStickerPackSchema.safeParse({
      layout: '4x4',
      candidateLayout: '4x4',
      candidateCount: '16',
      selectedStartMs: '1000',
      selectedEndMs: '61001',
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected parse to fail for segment over 60000ms');
    }
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.path).toEqual(['selectedEndMs']);
    expect(result.error.issues[0]?.message).toBe('Selected video segment must be at most 60000 ms');
  });

  it('rejects non-4x4 output layout for MVP', () => {
    expect(() =>
      generateVideoStickerPackSchema.parse({
        layout: '5x5',
        candidateLayout: '4x4',
        candidateCount: '25',
        selectedStartMs: '0',
        selectedEndMs: '30000',
      })
    ).toThrow();
  });

  it('rejects non-4x4 candidate layout for MVP', () => {
    expect(() =>
      generateVideoStickerPackSchema.parse({
        layout: '4x4',
        candidateLayout: '5x5',
        candidateCount: '25',
        selectedStartMs: '0',
        selectedEndMs: '30000',
      })
    ).toThrow();
  });
});
