import type { Agent as AnviaAgent } from '@anvia/core';
import { anviaCore } from '../../core';
import { getCompletionModelForRole } from '../../provider/completion-model';
import { getLangfuseObserver } from '../../tracing';
import {
  videoStickerPackAgentPlanSchema,
  type VideoStickerCandidate,
  type VideoStickerPackAgentPlan,
} from '../../../utils/video-sticker-pack';
import { buildSystemPrompt } from './prompts';
import { buildVideoStickerPackAgentTools } from './tools';

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

export { buildVideoStickerPackAgentUserMessage } from './prompts';

export async function createVideoStickerPackAgent(
  input: VideoStickerPackAgentInput
): Promise<AnviaAgent<VideoStickerPackAgentPlan>> {
  const [{ Agent, createTool }, binding] = await Promise.all([
    anviaCore(),
    getCompletionModelForRole('agent'),
  ]);
  const observer = await getLangfuseObserver();
  const tools = buildVideoStickerPackAgentTools(createTool, input);

  return new Agent({
    id: VIDEO_STICKER_PACK_AGENT_ID,
    model: binding.model,
    instructions: buildSystemPrompt(input),
    tools,
    outputSchema: videoStickerPackAgentPlanSchema,
    ...(binding.temperature !== null ? { temperature: binding.temperature } : {}),
    ...(binding.maxTokens !== null ? { maxTokens: binding.maxTokens } : {}),
    ...(binding.reasoningEffort
      ? { controls: { reasoningEffort: binding.reasoningEffort } }
      : {}),
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
