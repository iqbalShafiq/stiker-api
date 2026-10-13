import { AIGenerationError } from '../errors';
import { loadAiModel } from '../ai/models/catalog';
import {
  VIDEO_STICKER_PACK_INPUT_LAYOUT,
  VIDEO_STICKER_PACK_OUTPUT_LAYOUT,
  normalizeVideoStickerPackPlan,
  type VideoStickerPackPlan,
} from '../utils/video-sticker-pack';
import {
  VIDEO_STICKER_PACK_AGENT_ID,
  buildVideoStickerPackAgentUserMessage,
  createVideoStickerPackAgent,
  type VideoStickerPackAgentInput,
} from '../ai/video-sticker-pack-agent';

export type { VideoStickerPackAgentInput } from '../ai/video-sticker-pack-agent';

export interface VideoStickerPackAgentResult {
  plan: VideoStickerPackPlan;
  metadata: {
    model: string;
    mode: 'video-sticker-pack';
    candidateGridCount: number;
    candidateCount: number;
    inputLayout: string;
    outputLayout: string;
    selectedStartMs: number;
    selectedEndMs: number;
    sourceDurationMs?: number;
    tokensPrompt?: number;
    tokensCompletion?: number;
    latencyMs?: number;
  };
}

export class VideoStickerPackAgentService {
  async generatePlan(
    input: VideoStickerPackAgentInput & { userId?: string }
  ): Promise<VideoStickerPackAgentResult> {
    const startedAt = Date.now();

    try {
      const agentRow = await loadAiModel('agent');
      const agent = await createVideoStickerPackAgent(input);
      const outcome = await agent.generate({
        messages: [buildVideoStickerPackAgentUserMessage(input)],
        trace: {
          name: VIDEO_STICKER_PACK_AGENT_ID,
          ...(input.userId ? { userId: input.userId } : {}),
          metadata: {
            candidateCount: input.candidates.length,
            candidateGridCount: input.candidateGrids.length,
            selectedStartMs: input.selectedStartMs,
            selectedEndMs: input.selectedEndMs,
            ...(input.sourceDurationMs != null
              ? { sourceDurationMs: input.sourceDurationMs }
              : {}),
            hasStylePrompt: Boolean(input.prompt?.trim()),
          },
        },
      });

      if (outcome.type !== 'response') {
        throw new AIGenerationError(
          outcome.type === 'blocked'
            ? `Video sticker pack agent blocked: ${outcome.reason}`
            : 'Video sticker pack agent requires a human interaction'
        );
      }

      const plan = normalizeVideoStickerPackPlan(outcome.output, input.candidates);

      return {
        plan,
        metadata: {
          model: agentRow.modelId,
          mode: 'video-sticker-pack',
          candidateGridCount: input.candidateGrids.length,
          candidateCount: input.candidates.length,
          inputLayout: VIDEO_STICKER_PACK_INPUT_LAYOUT,
          outputLayout: VIDEO_STICKER_PACK_OUTPUT_LAYOUT,
          selectedStartMs: input.selectedStartMs,
          selectedEndMs: input.selectedEndMs,
          ...(input.sourceDurationMs != null ? { sourceDurationMs: input.sourceDurationMs } : {}),
          tokensPrompt: outcome.usage.inputTokens,
          tokensCompletion: outcome.usage.outputTokens,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      if (error instanceof AIGenerationError) {
        throw error;
      }

      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Video sticker pack agent failed';
      throw new AIGenerationError(message);
    }
  }
}
