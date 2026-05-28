import { z } from 'zod';
import { ValidationError } from '../errors';
import { normalizeTextDecorationStyle } from './text-asset-decoration';

export const VIDEO_STICKER_PACK_INPUT_LAYOUT = '4x4';
export const VIDEO_STICKER_PACK_OUTPUT_LAYOUT = '4x4';
export const VIDEO_STICKER_PACK_MAX_GRIDS = 2;
export const VIDEO_STICKER_PACK_MAX_CANDIDATES = 32;
export const VIDEO_STICKER_PACK_MAX_SEGMENT_MS = 60_000;
export const VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT = 8;
export const VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT = 2;
export const VIDEO_STICKER_PACK_MAX_STATIC_COUNT = 16;
export const VIDEO_STICKER_PACK_MAX_ANIMATED_COUNT = 4;
export const VIDEO_STICKER_PACK_MAX_TOTAL_STICKERS = 16;
export const VIDEO_STICKER_PACK_MAX_ANIMATED_FRAMES = 24;

const cellIdSchema = z.string().regex(/^[A-D][1-4]$/);
const finiteNumber = z.number().finite();

const textDecorationSchema = z.object({
  type: z.literal('text'),
  text: z.string().trim().min(1).max(64),
  style: z.object({
    fontFamily: z.string().trim().max(80).optional(),
    color: z.string().trim().max(40).optional(),
    weight: z.string().trim().max(40).optional(),
  }).optional(),
  centerX: z.number().min(0).max(1).default(0.5),
  centerY: z.number().min(0).max(1).default(0.88),
  scale: z.number().min(0.1).max(3).default(0.58),
});

const emojiDecorationSchema = z.object({
  type: z.literal('emoji'),
  emoji: z.string().trim().min(1).max(16),
  centerX: z.number().min(0).max(1).default(0.5),
  centerY: z.number().min(0).max(1).default(0.5),
  scale: z.number().min(0.1).max(3).default(1),
});

export const videoStickerDecorationSchema = z.discriminatedUnion('type', [
  textDecorationSchema,
  emojiDecorationSchema,
]);

export const videoStickerCandidateSchema = z.object({
  candidateId: z.string().trim().min(1).max(80),
  frameIndex: z.coerce.number().int().min(0).max(10_000),
  gridIndex: z.coerce.number().int().min(0).max(VIDEO_STICKER_PACK_MAX_GRIDS - 1),
  cellId: cellIdSchema,
  timestampMs: z.coerce.number().int().min(0),
  sharpnessScore: finiteNumber.default(0),
  brightnessScore: finiteNumber.default(0),
  differenceScore: finiteNumber.default(0),
});

export const videoStickerCandidateManifestSchema = z
  .array(videoStickerCandidateSchema)
  .min(1)
  .max(VIDEO_STICKER_PACK_MAX_CANDIDATES)
  .superRefine((items, ctx) => {
    const ids = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (ids.has(item.candidateId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate candidateId: ${item.candidateId}`,
          path: [index, 'candidateId'],
        });
      }
      ids.add(item.candidateId);
    }
  });

export const videoStaticStickerPlanSchema = z.object({
  candidateId: z.string().trim().min(1).max(80),
  frameIndex: z.coerce.number().int().min(0).max(10_000),
  timestampMs: z.coerce.number().int().min(0),
  cellId: cellIdSchema,
  emojis: z.array(z.string().trim().min(1).max(16)).max(3).default(['⭐']),
  accessibilityText: z.string().trim().max(125).optional(),
  decorations: z.array(videoStickerDecorationSchema).default([]),
  rationale: z.string().trim().max(500).optional(),
});

export const videoAnimatedTimelineFrameSchema = z.object({
  candidateId: z.string().trim().min(1).max(80).optional(),
  frameIndex: z.coerce.number().int().min(0).max(10_000),
  timestampMs: z.coerce.number().int().min(0),
  durationMs: z.coerce.number().int().min(8).max(1000),
});

export const videoAnimatedFrameDecorationSchema = z.object({
  frameIndex: z.coerce.number().int().min(0).max(VIDEO_STICKER_PACK_MAX_ANIMATED_FRAMES - 1),
  decorations: z.array(videoStickerDecorationSchema).default([]),
});

export const videoAnimatedStickerPlanSchema = z.object({
  timeline: z.array(videoAnimatedTimelineFrameSchema)
    .min(2)
    .max(VIDEO_STICKER_PACK_MAX_ANIMATED_FRAMES),
  fps: z.coerce.number().int().min(8).max(30).default(12),
  loopCount: z.coerce.number().int().min(0).max(10).default(0),
  emojis: z.array(z.string().trim().min(1).max(16)).max(3).default(['⭐']),
  accessibilityText: z.string().trim().max(255).optional(),
  baseDecorations: z.array(videoStickerDecorationSchema).default([]),
  frameDecorations: z.array(videoAnimatedFrameDecorationSchema).default([]),
  rationale: z.string().trim().max(500).optional(),
});

export const videoStickerPackPlanSchema = z.object({
  packTitle: z.string().trim().min(1).max(80).default('Video Sticker Pack'),
  summary: z.string().trim().max(1000).optional(),
  staticStickers: z.array(videoStaticStickerPlanSchema).max(VIDEO_STICKER_PACK_MAX_STATIC_COUNT).default([]),
  animatedStickers: z.array(videoAnimatedStickerPlanSchema).max(VIDEO_STICKER_PACK_MAX_ANIMATED_COUNT).default([]),
  rejectedCandidates: z.array(z.object({
    candidateId: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(240),
  })).max(VIDEO_STICKER_PACK_MAX_CANDIDATES).default([]),
}).superRefine((plan, ctx) => {
  const total = plan.staticStickers.length + plan.animatedStickers.length;
  if (total < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Plan must contain at least one sticker',
      path: ['staticStickers'],
    });
  }
  if (total > VIDEO_STICKER_PACK_MAX_TOTAL_STICKERS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Plan may contain at most ${VIDEO_STICKER_PACK_MAX_TOTAL_STICKERS} stickers`,
      path: ['staticStickers'],
    });
  }
});

export type VideoStickerCandidate = z.infer<typeof videoStickerCandidateSchema>;
export type VideoStickerPackPlan = z.infer<typeof videoStickerPackPlanSchema>;

export interface VideoStickerPackRequestShape {
  candidateGridCount: number;
  candidateCount: number;
  selectedStartMs: number;
  selectedEndMs: number;
}

export function parseCandidateManifest(raw: unknown): VideoStickerCandidate[] {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return videoStickerCandidateManifestSchema.parse(parsed);
}

export function validateVideoStickerPackRequestShape(input: VideoStickerPackRequestShape): void {
  if (input.candidateGridCount < 1) {
    throw new ValidationError('At least one candidate grid image is required');
  }
  if (input.candidateGridCount > VIDEO_STICKER_PACK_MAX_GRIDS) {
    throw new ValidationError(`At most ${VIDEO_STICKER_PACK_MAX_GRIDS} candidate grid images are allowed`);
  }
  if (input.candidateCount < 1 || input.candidateCount > VIDEO_STICKER_PACK_MAX_CANDIDATES) {
    throw new ValidationError(`candidateCount must be between 1 and ${VIDEO_STICKER_PACK_MAX_CANDIDATES}`);
  }
  if (input.selectedStartMs < 0) {
    throw new ValidationError('selectedStartMs must be non-negative');
  }
  if (input.selectedEndMs <= input.selectedStartMs) {
    throw new ValidationError('selectedEndMs must be greater than selectedStartMs');
  }
  if (input.selectedEndMs - input.selectedStartMs > VIDEO_STICKER_PACK_MAX_SEGMENT_MS) {
    throw new ValidationError(`Selected video segment must be at most ${VIDEO_STICKER_PACK_MAX_SEGMENT_MS} ms`);
  }
}

export function normalizeVideoStickerPackPlan(raw: unknown, candidates: VideoStickerCandidate[]): VideoStickerPackPlan {
  const plan = videoStickerPackPlanSchema.parse(raw);
  const byId = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));

  const normalizeStatic = plan.staticStickers.map(sticker => {
    const candidate = byId.get(sticker.candidateId);
    if (!candidate) {
      throw new ValidationError(`Unknown static sticker candidateId: ${sticker.candidateId}`);
    }
    return {
      ...sticker,
      frameIndex: candidate.frameIndex,
      timestampMs: candidate.timestampMs,
      cellId: candidate.cellId,
      decorations: sticker.decorations.map(normalizeDecoration),
    };
  });

  const normalizeAnimated = plan.animatedStickers.map(sticker => ({
    ...sticker,
    timeline: sticker.timeline.map(frame => {
      if (frame.candidateId) {
        const candidate = byId.get(frame.candidateId);
        if (!candidate) {
          throw new ValidationError(`Unknown animated sticker candidateId: ${frame.candidateId}`);
        }
        return {
          ...frame,
          frameIndex: candidate.frameIndex,
          timestampMs: candidate.timestampMs,
        };
      }
      return frame;
    }).sort((a, b) => a.timestampMs - b.timestampMs),
    baseDecorations: sticker.baseDecorations.map(normalizeDecoration),
    frameDecorations: sticker.frameDecorations.map(entry => ({
      ...entry,
      decorations: entry.decorations.map(normalizeDecoration),
    })),
  }));

  return {
    ...plan,
    staticStickers: normalizeStatic,
    animatedStickers: normalizeAnimated,
  };
}

export function validatePlanForRequest(
  plan: VideoStickerPackPlan,
  candidates: VideoStickerCandidate[]
): { valid: boolean; errors: string[]; normalizedPlan?: VideoStickerPackPlan } {
  try {
    return {
      valid: true,
      errors: [],
      normalizedPlan: normalizeVideoStickerPackPlan(plan, candidates),
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Invalid video sticker pack plan'],
    };
  }
}

export function rankStaticCandidates(candidates: VideoStickerCandidate[], limit = VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT): VideoStickerCandidate[] {
  return [...candidates]
    .filter(candidate => candidate.brightnessScore >= 0.12 && candidate.brightnessScore <= 0.92)
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, Math.max(1, Math.min(limit, VIDEO_STICKER_PACK_MAX_STATIC_COUNT)));
}

export function proposeAnimatedLoops(
  candidates: VideoStickerCandidate[],
  limit = VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT
): Array<{ timeline: VideoStickerCandidate[]; reason: string }> {
  const ordered = [...candidates].sort((a, b) => a.timestampMs - b.timestampMs);
  const windows: Array<{ timeline: VideoStickerCandidate[]; reason: string; score: number }> = [];
  const windowSize = Math.min(8, ordered.length);
  if (windowSize < 2) return [];

  for (let start = 0; start <= ordered.length - windowSize; start += Math.max(1, Math.floor(windowSize / 2))) {
    const timeline = ordered.slice(start, start + windowSize);
    const span = timeline[timeline.length - 1].timestampMs - timeline[0].timestampMs;
    if (span <= 10_000) {
      windows.push({
        timeline,
        reason: 'Consecutive clear frames with manageable duration for an animated sticker.',
        score: timeline.reduce((sum, candidate) => sum + scoreCandidate(candidate), 0) / timeline.length,
      });
    }
  }

  return windows
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, Math.min(limit, VIDEO_STICKER_PACK_MAX_ANIMATED_COUNT)))
    .map(({ timeline, reason }) => ({ timeline, reason }));
}

function scoreCandidate(candidate: VideoStickerCandidate): number {
  const brightnessPenalty = Math.abs(candidate.brightnessScore - 0.52);
  return candidate.sharpnessScore * 2 + candidate.differenceScore - brightnessPenalty;
}

function normalizeDecoration(
  decoration: z.infer<typeof videoStickerDecorationSchema>
): z.infer<typeof videoStickerDecorationSchema> {
  if (decoration.type !== 'text') {
    return decoration;
  }
  return {
    ...decoration,
    style: normalizeTextDecorationStyle(decoration.style),
  };
}
