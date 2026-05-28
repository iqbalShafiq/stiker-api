import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoStickerPackAgentService } from '../../../src/services/video-sticker-pack-agent.service';
import type { VideoStickerCandidate } from '../../../src/utils/video-sticker-pack';

const invokeMock = vi.hoisted(() => vi.fn());
const createAgentMock = vi.hoisted(() => vi.fn(() => ({ invoke: invokeMock })));
const toolMock = vi.hoisted(() => vi.fn((fn, fields) => ({ ...fields, fn })));
const toolStrategyMock = vi.hoisted(() => vi.fn(schema => ({ schema, strategy: 'tool' })));

vi.mock('langchain', () => ({
  createAgent: createAgentMock,
  tool: toolMock,
  toolStrategy: toolStrategyMock,
}));

vi.mock('@langchain/openrouter', () => ({
  ChatOpenRouter: vi.fn(function ChatOpenRouter(fields) {
    return { fields };
  }),
}));

const candidates: VideoStickerCandidate[] = [
  {
    candidateId: 'f_001',
    frameIndex: 1,
    gridIndex: 0,
    cellId: 'A1',
    timestampMs: 1_000,
    sharpnessScore: 0.8,
    brightnessScore: 0.5,
    differenceScore: 0.4,
  },
  {
    candidateId: 'f_002',
    frameIndex: 2,
    gridIndex: 0,
    cellId: 'A2',
    timestampMs: 1_500,
    sharpnessScore: 0.7,
    brightnessScore: 0.55,
    differenceScore: 0.3,
  },
];

describe('VideoStickerPackAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads structuredResponse from LangChain agent and normalizes candidate references', async () => {
    invokeMock.mockResolvedValueOnce({
      structuredResponse: {
        packTitle: 'Video Reactions',
        staticStickers: [
          {
            candidateId: 'f_001',
            frameIndex: 999,
            timestampMs: 999,
            cellId: 'D4',
            emojis: ['😀'],
            decorations: [],
          },
        ],
        animatedStickers: [
          {
            timeline: [
              { candidateId: 'f_002', frameIndex: 0, timestampMs: 0, durationMs: 120 },
              { candidateId: 'f_001', frameIndex: 0, timestampMs: 0, durationMs: 120 },
            ],
            emojis: ['🎬'],
            baseDecorations: [],
            frameDecorations: [],
          },
        ],
      },
      messages: [
        {
          usage_metadata: {
            input_tokens: 123,
            output_tokens: 45,
          },
        },
      ],
    });

    const service = new VideoStickerPackAgentService();
    const result = await service.generatePlan({
      candidateGrids: [{ buffer: Buffer.from('grid'), mimeType: 'image/png' }],
      candidates,
      selectedStartMs: 0,
      selectedEndMs: 10_000,
      sourceDurationMs: 30_000,
    });

    expect(createAgentMock).toHaveBeenCalledTimes(1);
    expect(toolStrategyMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result.plan.staticStickers[0]).toMatchObject({
      candidateId: 'f_001',
      frameIndex: 1,
      timestampMs: 1_000,
      cellId: 'A1',
    });
    expect(result.plan.animatedStickers[0].timeline.map(frame => frame.candidateId)).toEqual(['f_001', 'f_002']);
    expect(result.metadata).toMatchObject({
      model: 'openai/gpt-4.1-mini',
      mode: 'video-sticker-pack',
      candidateGridCount: 1,
      candidateCount: 2,
      tokensPrompt: 123,
      tokensCompletion: 45,
    });
  });

  it('falls back to parsing final message JSON when structuredResponse is absent', async () => {
    invokeMock.mockResolvedValueOnce({
      messages: [
        {
          content: JSON.stringify({
            packTitle: 'Fallback',
            staticStickers: [
              {
                candidateId: 'f_002',
                frameIndex: 2,
                timestampMs: 1_500,
                cellId: 'A2',
                emojis: ['⭐'],
                decorations: [],
              },
            ],
          }),
        },
      ],
    });

    const service = new VideoStickerPackAgentService();
    const result = await service.generatePlan({
      candidateGrids: [{ buffer: Buffer.from('grid'), mimeType: 'image/png' }],
      candidates,
      selectedStartMs: 0,
      selectedEndMs: 10_000,
    });

    expect(result.plan.packTitle).toBe('Fallback');
    expect(result.plan.staticStickers[0].candidateId).toBe('f_002');
  });

  it('wraps invalid agent responses as AI generation errors', async () => {
    invokeMock.mockResolvedValueOnce({
      structuredResponse: {
        packTitle: 'Bad',
        staticStickers: [
          {
            candidateId: 'missing',
            frameIndex: 1,
            timestampMs: 1,
            cellId: 'A1',
          },
        ],
      },
    });

    const service = new VideoStickerPackAgentService();

    await expect(service.generatePlan({
      candidateGrids: [{ buffer: Buffer.from('grid'), mimeType: 'image/png' }],
      candidates,
      selectedStartMs: 0,
      selectedEndMs: 10_000,
    })).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
      statusCode: 502,
    });
  });
});
