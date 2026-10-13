import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../../src/errors';
import { OpenRouterService } from '../../../src/services/openrouter.service';

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

function imageResult(overrides: { id?: string; cost?: number } = {}) {
  return {
    images: [{ data: Buffer.from('rendered-image'), mediaType: 'image/png' }],
    rawResponse: {
      id: overrides.id ?? 'gen-1',
      usage: { prompt_tokens: 10, completion_tokens: 20, cost: overrides.cost ?? 0.01 },
    },
  };
}

describe('OpenRouterService image generation on the Anvia path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards reference images via providerOptions and maps usage metadata', async () => {
    generateImageMock.mockResolvedValueOnce(imageResult());

    const service = new OpenRouterService();
    const result = await service.generateImageWithInputs('make a sticker', [
      { base64: 'abc', mimeType: 'image/png' },
    ]);

    expect(result.imageBuffer.toString()).toBe('rendered-image');
    expect(result.generationId).toBe('gen-1');
    expect(result.metadata).toEqual({
      model: 'bytedance-seed/seedream-5-0-flash',
      tokensPrompt: 10,
      tokensCompletion: 20,
      cost: 0.01,
      latencyMs: expect.any(Number),
    });

    const request = generateImageMock.mock.calls[0][0];
    expect(request.prompt).toBe('make a sticker');
    expect(request.providerOptions).toEqual({
      referenceImages: [{ base64: 'abc', mimeType: 'image/png' }],
    });
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to text-only when the provider rejects image input', async () => {
    generateImageMock
      .mockRejectedValueOnce(new ProviderError('Provider returned error'))
      .mockResolvedValueOnce(imageResult({ id: 'gen-2' }));

    const service = new OpenRouterService();
    const result = await service.generateImageWithInputs('prompt', [
      { base64: 'abc', mimeType: 'image/png' },
    ]);

    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(generateImageMock.mock.calls[1][0].providerOptions).toBeUndefined();
    expect(result.generationId).toBe('gen-2');
  });

  it('wraps unexpected failures as AIGenerationError without retrying', async () => {
    generateImageMock.mockRejectedValueOnce(new Error('boom'));

    const service = new OpenRouterService();

    await expect(
      service.generateImageWithInputs('prompt', [{ base64: 'abc', mimeType: 'image/png' }])
    ).rejects.toMatchObject({ code: 'AI_GENERATION_FAILED', statusCode: 502 });
    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });
});
