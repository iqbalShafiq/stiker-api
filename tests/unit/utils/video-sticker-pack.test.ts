import { describe, expect, it } from 'vitest';
import {
  VIDEO_STICKER_PACK_INPUT_LAYOUT,
  VIDEO_STICKER_PACK_MAX_CANDIDATES,
  VIDEO_STICKER_PACK_MAX_GRIDS,
  VIDEO_STICKER_PACK_MAX_SEGMENT_MS,
  normalizeVideoStickerPackAgentPlan,
  validateVideoStickerPackRequestShape,
} from '../../../src/utils/video-sticker-pack';

describe('video sticker pack utils', () => {
  it('defines MVP limits', () => {
    expect(VIDEO_STICKER_PACK_INPUT_LAYOUT).toBe('4x4');
    expect(VIDEO_STICKER_PACK_MAX_CANDIDATES).toBe(32);
    expect(VIDEO_STICKER_PACK_MAX_GRIDS).toBe(2);
    expect(VIDEO_STICKER_PACK_MAX_SEGMENT_MS).toBe(60_000);
  });

  it('accepts one or two candidate grids with a 60 second segment', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 2,
        candidateCount: 32,
        selectedStartMs: 15_000,
        selectedEndMs: 75_000,
      })
    ).not.toThrow();
  });

  it('rejects more than two candidate grids', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 3,
        candidateCount: 32,
        selectedStartMs: 0,
        selectedEndMs: 60_000,
      })
    ).toThrow('At most 2 candidate grid images are allowed');
  });

  it('rejects more than 32 candidates', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 2,
        candidateCount: 33,
        selectedStartMs: 0,
        selectedEndMs: 60_000,
      })
    ).toThrow('candidateCount must be between 1 and 32');
  });

  it('rejects candidateCount above 4x4 grid capacity across candidate grids', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 1,
        candidateCount: 17,
        selectedStartMs: 0,
        selectedEndMs: 30_000,
      })
    ).toThrow('candidateCount exceeds candidate grid capacity: 17 requested, 16 available (1 grid x 16 cells)');
  });

  it('accepts candidateCount at exact 4x4 grid capacity', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 2,
        candidateCount: 32,
        selectedStartMs: 0,
        selectedEndMs: 30_000,
      })
    ).not.toThrow();
  });

  it('rejects non-integer candidateCount', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 1,
        candidateCount: 1.5,
        selectedStartMs: 0,
        selectedEndMs: 30_000,
      })
    ).toThrow('candidateCount must be a finite non-negative integer');
  });

  it('rejects negative selectedStartMs', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 1,
        candidateCount: 16,
        selectedStartMs: -1,
        selectedEndMs: 30_000,
      })
    ).toThrow('selectedStartMs must be a finite non-negative integer');
  });

  it('rejects non-finite selectedEndMs', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 1,
        candidateCount: 16,
        selectedStartMs: 0,
        selectedEndMs: Number.NaN,
      })
    ).toThrow('selectedEndMs must be a finite non-negative integer');
  });

  it('rejects selected segment longer than 60 seconds', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 1,
        candidateCount: 16,
        selectedStartMs: 0,
        selectedEndMs: 60_001,
      })
    ).toThrow('Selected video segment must be at most 60000 ms');
  });

  it('normalizes agent JSON with selected cell ids and reasoning', () => {
    const plan = normalizeVideoStickerPackAgentPlan(
      JSON.stringify({
        generationPrompt: 'Create a cohesive expressive reaction sticker pack.',
        selectedCells: ['A1', 'B2', 'D4'],
        selectionReasoning: 'Picked sharp, expressive, visually distinct frames.',
      })
    );

    expect(plan).toEqual({
      generationPrompt: 'Create a cohesive expressive reaction sticker pack.',
      selectedCells: ['A1', 'B2', 'D4'],
      selectionReasoning: 'Picked sharp, expressive, visually distinct frames.',
    });
  });

  it('normalizes selectedCells to valid A1-D4 ids and dedupes while preserving order', () => {
    const plan = normalizeVideoStickerPackAgentPlan(
      JSON.stringify({
        generationPrompt: 'Prompt',
        selectedCells: ['a1', ' E1 ', 'B2', 'A1', 'C3', 'D5', 'b2', 4, null],
      })
    );

    expect(plan.selectedCells).toEqual(['A1', 'B2', 'C3']);
  });

  it('throws stable parse error for invalid JSON', () => {
    expect(() => normalizeVideoStickerPackAgentPlan('{')).toThrow(
      'Video sticker pack agent returned invalid JSON payload'
    );
  });
});
