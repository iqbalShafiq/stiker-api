import { ChatOpenRouter } from '@langchain/openrouter';
import { createAgent, tool, toolStrategy } from 'langchain';
import type { ClientTool, ServerTool } from '@langchain/core/tools';
import { z } from 'zod';
import { config } from '../config';
import { AIGenerationError, ValidationError } from '../errors';
import {
  VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT,
  VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT,
  VIDEO_STICKER_PACK_INPUT_LAYOUT,
  VIDEO_STICKER_PACK_OUTPUT_LAYOUT,
  VideoStickerCandidate,
  VideoStickerPackPlan,
  normalizeVideoStickerPackPlan,
  proposeAnimatedLoops,
  rankStaticCandidates,
  validatePlanForRequest,
  videoStickerPackPlanSchema,
} from '../utils/video-sticker-pack';

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

interface AgentInvokeResult {
  structuredResponse?: unknown;
  messages?: Array<{
    content?: unknown;
    usage_metadata?: {
      input_tokens?: number;
      output_tokens?: number;
    };
    response_metadata?: {
      tokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
      };
    };
  }>;
}

export class VideoStickerPackAgentService {
  async generatePlan(input: VideoStickerPackAgentInput): Promise<VideoStickerPackAgentResult> {
    if (!config.openRouterApiKey) {
      throw new ValidationError('OPENROUTER_API_KEY is required for video sticker pack generation');
    }

    const startedAt = Date.now();

    try {
      const model = new ChatOpenRouter({
        model: config.models.videoStickerPackAgent,
        apiKey: config.openRouterApiKey,
        siteUrl: config.appUrl,
        siteName: 'Setiker API',
        temperature: 0.2,
        maxTokens: 3500,
      });

      const agent = createAgent({
        model,
        tools: this.buildTools(input),
        systemPrompt: this.buildSystemPrompt(input),
        responseFormat: toolStrategy(videoStickerPackPlanSchema),
      });

      const result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: this.buildUserContent(input),
          },
        ],
      }) as AgentInvokeResult;

      const rawPlan = this.extractStructuredResponse(result);
      const plan = normalizeVideoStickerPackPlan(rawPlan, input.candidates);
      const usage = this.extractUsage(result);

      return {
        plan,
        metadata: {
          model: config.models.videoStickerPackAgent,
          mode: 'video-sticker-pack',
          candidateGridCount: input.candidateGrids.length,
          candidateCount: input.candidates.length,
          inputLayout: VIDEO_STICKER_PACK_INPUT_LAYOUT,
          outputLayout: VIDEO_STICKER_PACK_OUTPUT_LAYOUT,
          selectedStartMs: input.selectedStartMs,
          selectedEndMs: input.selectedEndMs,
          ...(input.sourceDurationMs != null ? { sourceDurationMs: input.sourceDurationMs } : {}),
          ...usage,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      if (error instanceof AIGenerationError) {
        throw error;
      }

      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Video sticker pack agent failed';
      throw new AIGenerationError(message);
    }
  }

  private buildTools(input: VideoStickerPackAgentInput): Array<ClientTool | ServerTool> {
    const candidateInventory = tool(
      () => JSON.stringify({
        candidates: input.candidates,
        selectedStartMs: input.selectedStartMs,
        selectedEndMs: input.selectedEndMs,
        sourceDurationMs: input.sourceDurationMs,
      }),
      {
        name: 'read_candidate_inventory',
        description: 'Read all frame candidates and their quality/timestamp metadata.',
        schema: z.object({}),
      }
    );

    const rankClearStaticCandidatesTool = tool(
      ({ limit }) => JSON.stringify({
        candidates: rankStaticCandidates(input.candidates, limit),
      }),
      {
        name: 'rank_clear_static_candidates',
        description: 'Return sharp, bright, visually distinct candidates that are good static sticker choices.',
        schema: z.object({
          limit: z.number().int().positive().max(16).default(input.maxStaticStickers ?? VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT),
        }),
      }
    );

    const proposeAnimatedLoopsTool = tool(
      ({ limit }) => JSON.stringify({
        loops: proposeAnimatedLoops(input.candidates, limit),
      }),
      {
        name: 'propose_animated_loops',
        description: 'Return lightweight timeline proposals made from consecutive frame candidates.',
        schema: z.object({
          limit: z.number().int().nonnegative().max(4).default(input.maxAnimatedStickers ?? VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT),
        }),
      }
    );

    const validateStickerPackPlanTool = tool(
      ({ plan }) => JSON.stringify(validatePlanForRequest(plan, input.candidates)),
      {
        name: 'validate_sticker_pack_plan',
        description: 'Validate that a proposed video sticker pack plan references existing candidates and obeys limits.',
        schema: z.object({
          plan: videoStickerPackPlanSchema,
        }),
      }
    );

    return [
      candidateInventory,
      rankClearStaticCandidatesTool,
      proposeAnimatedLoopsTool,
      validateStickerPackPlanTool,
    ];
  }

  private buildSystemPrompt(input: VideoStickerPackAgentInput): string {
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

  private buildUserContent(input: VideoStickerPackAgentInput): Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const stylePrompt = input.prompt?.trim();
    const text = `Create a video sticker pack manifest.

Optional user style prompt: ${stylePrompt && stylePrompt.length > 0 ? stylePrompt : '(none)'}

Selected range: ${input.selectedStartMs}ms to ${input.selectedEndMs}ms.
Source duration: ${input.sourceDurationMs ?? 'unknown'}ms.
Candidate count: ${input.candidates.length}.
Candidate manifest:
${JSON.stringify(input.candidates, null, 2)}`;

    return [
      { type: 'text', text },
      ...input.candidateGrids.map(grid => ({
        type: 'image_url',
        image_url: {
          url: `data:${normalizeImageMime(grid.mimeType)};base64,${grid.buffer.toString('base64')}`,
        },
      })),
    ];
  }

  private extractStructuredResponse(result: AgentInvokeResult): unknown {
    if (result.structuredResponse) {
      return result.structuredResponse;
    }

    const lastContent = result.messages?.at(-1)?.content;
    if (typeof lastContent === 'string' && lastContent.trim()) {
      return JSON.parse(stripJsonFence(lastContent));
    }

    throw new AIGenerationError('Video sticker pack agent did not return a structured plan');
  }

  private extractUsage(result: AgentInvokeResult): { tokensPrompt?: number; tokensCompletion?: number } {
    const messages = result.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      const inputTokens = message.usage_metadata?.input_tokens ?? message.response_metadata?.tokenUsage?.promptTokens;
      const outputTokens = message.usage_metadata?.output_tokens ?? message.response_metadata?.tokenUsage?.completionTokens;
      if (inputTokens != null || outputTokens != null) {
        return {
          ...(inputTokens != null ? { tokensPrompt: inputTokens } : {}),
          ...(outputTokens != null ? { tokensCompletion: outputTokens } : {}),
        };
      }
    }
    return {};
  }
}

function normalizeImageMime(mimeType: string): string {
  return /^image\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'image/png';
}

function stripJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
