import { afterEach, describe, expect, it, vi } from 'vitest';

const chatCreateMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn(function OpenAIMock() {
    return { chat: { completions: { create: chatCreateMock } } };
  }),
}));

import {
  extractImagesFromAssistantMessage,
  getOpenRouterImageModel,
} from '../../../src/ai/openrouter-image';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Raw-base64 decoding keeps the production guard that ignores short strings. */
const LONG_BASE64 = Buffer.concat([
  Buffer.from(PNG_BASE64, 'base64'),
  Buffer.from('x'.repeat(160)),
]).toString('base64');

describe('extractImagesFromAssistantMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes a data URL image from message.images', async () => {
    const images = await extractImagesFromAssistantMessage({
      images: [{ image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }],
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(PNG_BASE64);
  });

  it('decodes b64_json fields', async () => {
    const images = await extractImagesFromAssistantMessage({
      images: [{ b64_json: LONG_BASE64 }],
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(LONG_BASE64);
  });

  it('fetches http image URLs', async () => {
    const bytes = Buffer.from(PNG_BASE64, 'base64');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, { status: 200 }))
    );
    const images = await extractImagesFromAssistantMessage({
      images: [{ image_url: { url: 'https://example.com/image.png' } }],
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(PNG_BASE64);
  });

  it('decodes markdown image URLs inside content strings', async () => {
    const bytes = Buffer.from(PNG_BASE64, 'base64');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, { status: 200 }))
    );
    const images = await extractImagesFromAssistantMessage({
      content: `Here is your sticker: ![sticker](https://example.com/sticker.png)`,
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(PNG_BASE64);
  });

  it('throws AIGenerationError when no image can be decoded', async () => {
    await expect(
      extractImagesFromAssistantMessage({ content: 'no image here' })
    ).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
      statusCode: 502,
    });
  });

  it('requests image output alongside text and forwards reference images', async () => {
    chatCreateMock.mockResolvedValueOnce({
      id: 'gen-1',
      choices: [{ message: { images: [{ b64_json: LONG_BASE64 }] } }],
      usage: {},
    });

    const model = getOpenRouterImageModel('test-image-model');
    const result = await model.imageGeneration({
      prompt: 'make a sticker',
      width: 1024,
      height: 1024,
      providerOptions: { referenceImages: [{ base64: 'abc', mimeType: 'image/png' }] },
    });

    const request = chatCreateMock.mock.calls[0][0] as {
      modalities?: string[];
      model: string;
      messages: Array<{ content: unknown[] }>;
    };
    expect(request.model).toBe('test-image-model');
    expect(request.modalities).toEqual(['image', 'text']);
    expect(request.messages[0].content).toEqual([
      { type: 'text', text: 'make a sticker' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ]);
    expect(result.images).toHaveLength(1);
  });
});
