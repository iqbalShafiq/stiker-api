import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoStickerPackAgentService } from '../../../src/services/video-sticker-pack-agent.service';
import type { VideoStickerCandidate } from '../../../src/utils/video-sticker-pack';

const generateMock = vi.hoisted(() => vi.fn());
const createAgentMock = vi.hoisted(() => vi.fn());
const buildUserMessageMock = vi.hoisted(() =>
  vi.fn(() => ({ role: 'user', content: [{ type: 'text', text: 'built-message' }] }))
);

vi.mock('../../../src/ai/agents/video-sticker-pack/agent', () => ({
  VIDEO_STICKER_PACK_AGENT_ID: 'video-sticker-pack',
  createVideoStickerPackAgent: createAgentMock,
  buildVideoStickerPackAgentUserMessage: buildUserMessageMock,
}));

vi.mock('../../../src/ai/models/catalog', () => ({
  loadAiModel: vi.fn(async () => ({
    role: 'agent',
    modelId: 'meta/muse-spark-1.3-contributor',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'high',
    temperature: 0.2,
    maxTokens: 4000,
  })),
  MissingAiModelError: class MissingAiModelError extends Error {},
}));

const usage = {
  inputTokens: 123,
  outputTokens: 45,
  totalTokens: 168,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
};

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

const baseInput = {
  candidateGrids: [{ buffer: Buffer.from('grid'), mimeType: 'image/png' }],
  candidates,
  selectedStartMs: 0,
  selectedEndMs: 10_000,
  sourceDurationMs: 30_000,
};

describe('VideoStickerPackAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentMock.mockResolvedValue({ generate: generateMock });
  });

  it('normalizes candidate references from the validated agent output and maps usage metadata', async () => {
    generateMock.mockResolvedValueOnce({
      type: 'response',
      output: {
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
      usage,
    });

    const service = new VideoStickerPackAgentService();
    const result = await service.generatePlan({ ...baseInput, userId: 'user-1' });

    expect(createAgentMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(buildUserMessageMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][0].trace.userId).toBe('user-1');
    expect(result.plan.staticStickers[0]).toMatchObject({
      candidateId: 'f_001',
      frameIndex: 1,
      timestampMs: 1_000,
      cellId: 'A1',
    });
    expect(result.plan.animatedStickers[0].timeline.map(frame => frame.candidateId)).toEqual([
      'f_001',
      'f_002',
    ]);
    expect(result.metadata).toMatchObject({
      model: 'meta/muse-spark-1.3-contributor',
      mode: 'video-sticker-pack',
      candidateGridCount: 1,
      candidateCount: 2,
      tokensPrompt: 123,
      tokensCompletion: 45,
    });
  });

  it('fails when the agent run does not produce a response outcome', async () => {
    generateMock.mockResolvedValueOnce({
      type: 'interaction',
      interaction: { type: 'tool-approval' },
      usage,
    });

    const service = new VideoStickerPackAgentService();

    await expect(service.generatePlan(baseInput)).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
      statusCode: 502,
    });
  });

  it('wraps invalid agent outputs as AI generation errors', async () => {
    generateMock.mockResolvedValueOnce({
      type: 'response',
      output: {
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
      usage,
    });

    const service = new VideoStickerPackAgentService();

    await expect(service.generatePlan(baseInput)).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
      statusCode: 502,
    });
  });
});
