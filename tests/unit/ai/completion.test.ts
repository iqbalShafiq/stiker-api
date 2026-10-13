import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateStructuredCompletion } from '../../../src/ai/completion';

const generateCompletionMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/ai/core', () => ({
  anviaCore: vi.fn(async () => ({ generateCompletion: generateCompletionMock })),
}));

vi.mock('../../../src/ai/openrouter', () => ({
  getAgentCompletionModel: vi.fn(async () => ({ provider: 'test', modelId: 'agent-model' })),
  getVisionCompletionModel: vi.fn(async () => ({ provider: 'test', modelId: 'vision-model' })),
  getImprovementCompletionModel: vi.fn(async () => ({
    provider: 'test',
    modelId: 'improvement-model',
  })),
}));

describe('generateStructuredCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes instructions, image parts, schema and abort signal to generateCompletion', async () => {
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
    expect(request.model.modelId).toBe('vision-model');
    expect(request.instructions).toBe('describe it');
    expect(request.messages[0].content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(request.messages[0].content[1]).toEqual({
      type: 'image',
      image: { type: 'data', data: Buffer.from('img').toString('base64') },
      mediaType: 'image/png',
    });
    expect(request.outputSchema).toBe(schema);
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      output: { ok: true },
      usage: { inputTokens: 5, outputTokens: 7 },
      cost: 0.02,
      latencyMs: expect.any(Number),
    });
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
