import { z } from 'zod';
import type { Agent as AnviaAgent, AnyTool, UserMessage } from '@anvia/core';
import { anviaCore } from './core';
import { buildUserContent } from './completion';
import { getAgentCompletionModel } from './openrouter';
import { getLangfuseObserver } from './tracing';
import {
  VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT,
  VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT,
  proposeAnimatedLoops,
  rankStaticCandidates,
  validatePlanForRequest,
  videoStickerPackPlanSchema,
  type VideoStickerCandidate,
  type VideoStickerPackPlan,
} from '../utils/video-sticker-pack';

export const VIDEO_STICKER_PACK_AGENT_ID = 'video-sticker-pack';

export interface VideoStickerPackAgentInput {
  candidateGrids: Array<{
    buffer: Buffer;
    mimeType: string;
  }>;
  candidates: VideoStickerCandidate[];
  selectedStartMs: number;
  selectedEndMs: number;
  sourceDurationMs?: number;
  prompt?: string;
  maxStaticStickers?: number;
  maxAnimatedStickers?: number;
}

export async function createVideoStickerPackAgent(
  input: VideoStickerPackAgentInput
): Promise<AnviaAgent<VideoStickerPackPlan>> {
  const { Agent, createTool } = await anviaCore();
  const model = await getAgentCompletionModel();
  const observer = await getLangfuseObserver();

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

  const tools: AnyTool[] = [
    candidateInventory,
    rankClearStaticCandidatesTool,
    proposeAnimatedLoopsTool,
    validateStickerPackPlanTool,
  ];

  return new Agent({
    id: VIDEO_STICKER_PACK_AGENT_ID,
    model,
    instructions: buildSystemPrompt(input),
    tools,
    outputSchema: videoStickerPackPlanSchema,
    temperature: 0.2,
    maxTokens: 3500,
    maxTurns: 8,
    retries: { maxAttempts: 2 },
    ...(observer
      ? {
          observability: {
            observers: { langfuse: observer },
            primaryTrace: 'langfuse' as const,
          },
        }
      : {}),
  });
}

export function buildVideoStickerPackAgentUserMessage(
  input: VideoStickerPackAgentInput
): UserMessage {
  const stylePrompt = input.prompt?.trim();
  const text = `Create a video sticker pack manifest.

Optional user style prompt: ${stylePrompt && stylePrompt.length > 0 ? stylePrompt : '(none)'}

Selected range: ${input.selectedStartMs}ms to ${input.selectedEndMs}ms.
Source duration: ${input.sourceDurationMs ?? 'unknown'}ms.
Candidate count: ${input.candidates.length}.
Candidate manifest:
${JSON.stringify(input.candidates, null, 2)}`;

  return {
    role: 'user',
    content: buildUserContent({ text, images: input.candidateGrids }),
  };
}

function buildSystemPrompt(input: VideoStickerPackAgentInput): string {
  const maxStatic = input.maxStaticStickers ?? VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT;
  const maxAnimated = input.maxAnimatedStickers ?? VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT;

  return `You are Setiker's video-to-WhatsApp-sticker art director.

Goal:
- Analyze labeled candidate grid images and metadata.
- Select the best clear frames for static stickers.
- Select short coherent frame timelines for animated stickers only when motion looks useful.
- Return a JSON manifest only. Do not generate or edit images.

Rules:
- Prefer clear, expressive, non-blurry, non-duplicate frames.
- Use candidateId references from metadata exactly.
- Static sticker count target: up to ${maxStatic}.
- Animated sticker count target: up to ${maxAnimated}; use zero animated stickers if no good motion exists.
- Total stickers must be at most 16.
- Animated timelines should be 2-24 frames, ordered by timestamp, and <= 10 seconds total.
- Keep text decorations short and readable. Use bottom-caption placement unless there is a strong reason not to.
- Keep backend work cheap: use the provided tools and visual reasoning; do not ask for image generation.
- Before final answer, call validate_sticker_pack_plan and fix any validation errors.`;
}
