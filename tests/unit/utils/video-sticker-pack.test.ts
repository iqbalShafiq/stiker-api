import { describe, expect, it } from 'vitest';
import {
  VIDEO_STICKER_PACK_INPUT_LAYOUT,
  VIDEO_STICKER_PACK_MAX_CANDIDATES,
  VIDEO_STICKER_PACK_MAX_GRIDS,
  VIDEO_STICKER_PACK_MAX_SEGMENT_MS,
  normalizeVideoStickerPackPlan,
  parseCandidateManifest,
  proposeAnimatedLoops,
  rankStaticCandidates,
  validatePlanForRequest,
  validateVideoStickerPackRequestShape,
  type VideoStickerCandidate,
} from '../../../src/utils/video-sticker-pack';

const candidates: VideoStickerCandidate[] = [
  {
    candidateId: 'f_001',
    frameIndex: 1,
    gridIndex: 0,
    cellId: 'A1',
    timestampMs: 1_000,
    sharpnessScore: 0.7,
    brightnessScore: 0.5,
    differenceScore: 0.4,
  },
  {
    candidateId: 'f_002',
    frameIndex: 2,
    gridIndex: 0,
    cellId: 'A2',
    timestampMs: 1_500,
    sharpnessScore: 0.2,
    brightnessScore: 0.4,
    differenceScore: 0.1,
  },
  {
    candidateId: 'f_003',
    frameIndex: 3,
    gridIndex: 0,
    cellId: 'A3',
    timestampMs: 2_000,
    sharpnessScore: 0.8,
    brightnessScore: 0.55,
    differenceScore: 0.5,
  },
];

describe('video sticker pack utils', () => {
  it('defines MVP limits', () => {
    expect(VIDEO_STICKER_PACK_INPUT_LAYOUT).toBe('4x4');
    expect(VIDEO_STICKER_PACK_MAX_CANDIDATES).toBe(32);
    expect(VIDEO_STICKER_PACK_MAX_GRIDS).toBe(2);
    expect(VIDEO_STICKER_PACK_MAX_SEGMENT_MS).toBe(60_000);
  });

  it('parses candidate manifest JSON', () => {
    expect(parseCandidateManifest(JSON.stringify(candidates))).toEqual(candidates);
  });

  it('parses candidate manifest envelope JSON', () => {
    expect(parseCandidateManifest(JSON.stringify({ candidates }))).toEqual(candidates);
  });

  it('wraps invalid candidate manifest errors as validation errors', () => {
    expect(() => parseCandidateManifest('{not-json')).toThrow('Invalid candidateManifest: must be valid JSON');
    expect(() => parseCandidateManifest(JSON.stringify([{ candidateId: 'missing-fields' }]))).toThrow(
      'Invalid candidateManifest:'
    );
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

  it('rejects invalid request shape', () => {
    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 3,
        candidateCount: 32,
        selectedStartMs: 0,
        selectedEndMs: 60_000,
      })
    ).toThrow('At most 2 candidate grid images are allowed');

    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 1,
        candidateCount: 33,
        selectedStartMs: 0,
        selectedEndMs: 60_000,
      })
    ).toThrow('candidateCount must be between 1 and 32');

    expect(() =>
      validateVideoStickerPackRequestShape({
        candidateGridCount: 1,
        candidateCount: 16,
        selectedStartMs: 0,
        selectedEndMs: 60_001,
      })
    ).toThrow('Selected video segment must be at most 60000 ms');
  });

  it('normalizes selected static and animated candidates from the manifest', () => {
    const plan = normalizeVideoStickerPackPlan(
      {
        packTitle: 'Reactions',
        staticStickers: [
          {
            candidateId: 'f_001',
            frameIndex: 999,
            timestampMs: 999,
            cellId: 'D4',
            decorations: [
              {
                type: 'text',
                text: 'WOW',
                style: { fontFamily: '', color: '', weight: '' },
              },
            ],
          },
        ],
        animatedStickers: [
          {
            timeline: [
              { candidateId: 'f_003', frameIndex: 0, timestampMs: 0, durationMs: 120 },
              { candidateId: 'f_002', frameIndex: 0, timestampMs: 0, durationMs: 120 },
            ],
          },
        ],
      },
      candidates
    );

    expect(plan.staticStickers[0]).toMatchObject({
      candidateId: 'f_001',
      frameIndex: 1,
      timestampMs: 1_000,
      cellId: 'A1',
    });
    expect(plan.staticStickers[0].decorations[0]).toMatchObject({
      type: 'text',
      style: { fontFamily: 'sans-serif', color: '#FFFFFF', weight: 'regular' },
    });
    expect(plan.animatedStickers[0].timeline.map(frame => frame.candidateId)).toEqual(['f_002', 'f_003']);
  });

  it('validates unknown candidate references', () => {
    const result = validatePlanForRequest(
      {
        packTitle: 'Bad',
        staticStickers: [
          {
            candidateId: 'missing',
            frameIndex: 1,
            timestampMs: 1,
            cellId: 'A1',
            emojis: ['⭐'],
            decorations: [],
          },
        ],
        animatedStickers: [],
        rejectedCandidates: [],
      },
      candidates
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown static sticker candidateId');
  });

  it('ranks static candidates and proposes lightweight loops', () => {
    expect(rankStaticCandidates(candidates, 2).map(candidate => candidate.candidateId)).toEqual(['f_003', 'f_001']);
    expect(proposeAnimatedLoops(candidates, 1)[0].timeline).toHaveLength(3);
  });
});
