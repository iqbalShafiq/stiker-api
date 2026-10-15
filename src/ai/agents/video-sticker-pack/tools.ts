import { z } from 'zod';
import type { AnyTool } from '@anvia/core';
import {
  VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT,
  VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT,
  proposeAnimatedLoops,
  rankStaticCandidates,
  validatePlanForRequest,
  videoStickerPackPlanSchema,
} from '../../../utils/video-sticker-pack';
import type { VideoStickerPackAgentInput } from './agent';

/** The `createTool` factory destructured from the lazily-loaded `@anvia/core`. */
type CreateToolFn = (typeof import('@anvia/core'))['createTool'];

export function buildVideoStickerPackAgentTools(
  createTool: CreateToolFn,
  input: VideoStickerPackAgentInput
): AnyTool[] {
  const candidateInventory = createTool({
    name: 'read_candidate_inventory',
    description: 'Read all frame candidates and their quality/timestamp metadata.',
    inputSchema: z.object({}),
    execute: () =>
      JSON.stringify({
        candidates: input.candidates,
        selectedStartMs: input.selectedStartMs,
        selectedEndMs: input.selectedEndMs,
        sourceDurationMs: input.sourceDurationMs,
      }),
  });

  const rankClearStaticCandidatesTool = createTool({
    name: 'rank_clear_static_candidates',
    description:
      'Return sharp, bright, visually distinct candidates that are good static sticker choices.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .max(16)
        .default(input.maxStaticStickers ?? VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT),
    }),
    execute: ({ limit }) =>
      JSON.stringify({
        candidates: rankStaticCandidates(input.candidates, limit),
      }),
  });

  const proposeAnimatedLoopsTool = createTool({
    name: 'propose_animated_loops',
    description:
      'Return lightweight timeline proposals made from consecutive frame candidates.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .nonnegative()
        .max(4)
        .default(input.maxAnimatedStickers ?? VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT),
    }),
    execute: ({ limit }) =>
      JSON.stringify({
        loops: proposeAnimatedLoops(input.candidates, limit),
      }),
  });

  const validateStickerPackPlanTool = createTool({
    name: 'validate_sticker_pack_plan',
    description:
      'Validate that a proposed video sticker pack plan references existing candidates and obeys limits.',
    inputSchema: z.object({
      plan: videoStickerPackPlanSchema,
    }),
    execute: ({ plan }) => JSON.stringify(validatePlanForRequest(plan, input.candidates)),
  });

  return [
    candidateInventory,
    rankClearStaticCandidatesTool,
    proposeAnimatedLoopsTool,
    validateStickerPackPlanTool,
  ];
}
