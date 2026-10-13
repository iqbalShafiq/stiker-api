import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGenerationService } from '../../../src/services/image-generation.service';

const generateImageMock = vi.hoisted(() => vi.fn());
const loadAiModelMock = vi.hoisted(() =>
  vi.fn(async () => ({
    role: 'image',
    modelId: 'bytedance-seed/seedream-5-0-flash',
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    temperature: null,
    maxTokens: null,
  }))
);

vi.mock('../../../src/ai/core', () => ({
  anviaCore: vi.fn(async () => ({ generateImage: generateImageMock })),
}));

vi.mock('../../../src/ai/models/catalog', () => ({ loadAiModel: loadAiModelMock }));

function imageResult() {
  return {
    images: [{ data: Buffer.from('rendered-image'), mediaType: 'image/jpeg' }],
    rawResponse: {
      usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.018 },
    },
  };
}

describe('ImageGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAiModelMock.mockResolvedValue({
      role: 'image',
      modelId: 'bytedance-seed/seedream-5-0-flash',
      reasoningEfforts: [],
      defaultReasoningEffort: null,
      temperature: null,
      maxTokens: null,
    });
  });

  it('forwards reference images via providerOptions and maps usage metadata', async () => {
    generateImageMock.mockResolvedValueOnce(imageResult());

    const service = new ImageGenerationService();
    const result = await service.generateImageWithInputs('make a sticker', [
      { base64: 'abc', mimeType: 'image/png' },
    ]);

    expect(result.imageBuffer.toString()).toBe('rendered-image');
    expect(result.metadata).toEqual({
      model: 'bytedance-seed/seedream-5-0-flash',
      tokensPrompt: 10,
      tokensCompletion: 20,
      cost: 0.018,
      latencyMs: expect.any(Number),
    });

    const request = generateImageMock.mock.calls[0][0];
    expect(request.prompt).toBe('make a sticker');
    expect(request.providerOptions).toEqual({
      referenceImages: [{ base64: 'abc', mimeType: 'image/png' }],
    });
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('does not retry when the provider rejects image input', async () => {
    const providerError = new Error('Provider returned error');
    generateImageMock.mockRejectedValueOnce(providerError);

    const service = new ImageGenerationService();

    await expect(
      service.generateImageWithInputs('prompt', [{ base64: 'abc', mimeType: 'image/png' }])
    ).rejects.toMatchObject({ code: 'AI_GENERATION_FAILED' });
    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });
});
