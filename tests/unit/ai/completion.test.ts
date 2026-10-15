import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateStructuredCompletion } from '../../../src/ai/completion';

const generateCompletionMock = vi.hoisted(() => vi.fn());
const getCompletionModelForRoleMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/ai/core', () => ({
  anviaCore: vi.fn(async () => ({ generateCompletion: generateCompletionMock })),
}));

vi.mock('../../../src/ai/provider/completion-model', () => ({
  getCompletionModelForRole: getCompletionModelForRoleMock,
}));

const binding = {
  modelId: 'meta/muse-spark-1.3-contributor',
  model: { provider: 'test', modelId: 'meta/muse-spark-1.3-contributor' },
  reasoningEffort: 'medium',
  temperature: 0.2,
  maxTokens: 4000,
};

describe('generateStructuredCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompletionModelForRoleMock.mockResolvedValue(binding);
  });

  it('passes catalog bindings, instructions, image parts, schema and abort signal', async () => {
    const schema = z.object({ ok: z.boolean() });
    generateCompletionMock.mockResolvedValueOnce({
      output: { ok: true },
      usage: {
        inputTokens: 5,
        outputTokens: 7,
        totalTokens: 12,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      rawResponse: { usage: { cost: 0.02 } },
    });

    const result = await generateStructuredCompletion({
      role: 'vision',
      instructions: 'describe it',
      prompt: 'hello',
      images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
      outputSchema: schema,
      timeoutMs: 5000,
    });

    const request = generateCompletionMock.mock.calls[0][0];
    expect(request.model).toBe(binding.model);
    expect(request.instructions).toBe('describe it');
    expect(request.messages[0].content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(request.messages[0].content[1]).toEqual({
      type: 'image',
      image: { type: 'data', data: Buffer.from('img').toString('base64') },
      mediaType: 'image/png',
    });
    expect(request.outputSchema).toBe(schema);
    expect(request.temperature).toBe(0.2);
    expect(request.maxTokens).toBe(4000);
    expect(request.controls).toEqual({ reasoningEffort: 'medium' });
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      output: { ok: true },
      usage: { inputTokens: 5, outputTokens: 7 },
      cost: 0.02,
      latencyMs: expect.any(Number),
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(getCompletionModelForRoleMock).toHaveBeenCalledWith('vision');
  });

  it('omits decoding options the catalog row does not declare', async () => {
    getCompletionModelForRoleMock.mockResolvedValueOnce({
      ...binding,
      reasoningEffort: null,
      temperature: null,
      maxTokens: null,
    });
    generateCompletionMock.mockResolvedValueOnce({
      output: { ok: true },
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      rawResponse: {},
    });

    await generateStructuredCompletion({
      role: 'improvement',
      instructions: 'x',
      prompt: 'y',
      outputSchema: z.object({ ok: z.boolean() }),
      timeoutMs: 1000,
    });

    const request = generateCompletionMock.mock.calls[0][0];
    expect('temperature' in request).toBe(false);
    expect('maxTokens' in request).toBe(false);
    expect('controls' in request).toBe(false);
  });

  it('maps an aborted completion to TimeoutError', async () => {
    generateCompletionMock.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    );

    await expect(
      generateStructuredCompletion({
        role: 'improvement',
        instructions: 'x',
        prompt: 'y',
        outputSchema: z.object({ ok: z.boolean() }),
        timeoutMs: 1000,
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT_ERROR', statusCode: 504 });
  });
});
