import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aspectRatioFor,
  buildReferenceImagesProviderOptions,
  getImagesApiModel,
} from '../../../../src/ai/provider/images-api-model';

const fetchMock = vi.hoisted(() => vi.fn());

describe('images-api-model', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives gcd aspect ratios and falls back to auto for unsupported ones', () => {
    expect(aspectRatioFor(1024, 1024)).toBe('1:1');
    expect(aspectRatioFor(512, 1024)).toBe('1:2');
    expect(aspectRatioFor(100, 33)).toBe('auto');
  });

  it('posts model, prompt, aspect ratio and reference images to /images', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from('img').toString('base64'), media_type: 'image/jpeg' }],
          usage: { cost: 0.018 },
        }),
        { status: 200 }
      )
    );

    const model = getImagesApiModel('bytedance-seed/seedream-5-0-flash');
    const result = await model.imageGeneration({
      prompt: 'sticker',
      width: 1024,
      height: 1024,
      providerOptions: buildReferenceImagesProviderOptions([{ base64: 'abc', mimeType: 'image/png' }]),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.example/api/v1/images');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('bytedance-seed/seedream-5-0-flash');
    expect(body.prompt).toBe('sticker');
    expect(body.n).toBe(1);
    expect(body.aspect_ratio).toBe('1:1');
    expect(body.input_references).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ]);
    expect(Buffer.from(result.images[0].data).toString()).toBe('img');
    expect(result.images[0].mediaType).toBe('image/jpeg');
  });

  it('omits input_references when no reference images are supplied', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), {
        status: 200,
      })
    );

    const model = getImagesApiModel('bytedance-seed/seedream-5-0-flash');
    await model.imageGeneration({ prompt: 'p', width: 1024, height: 1024 });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect('input_references' in body).toBe(false);
  });

  it('throws AIGenerationError when the response carries no image data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const model = getImagesApiModel('x/y');

    await expect(
      model.imageGeneration({ prompt: 'p', width: 1, height: 1 })
    ).rejects.toMatchObject({ code: 'AI_GENERATION_FAILED' });
  });

  it('surfaces non-2xx payloads with the provider message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'insufficient credits', code: 402 } }), {
        status: 402,
      })
    );

    const model = getImagesApiModel('x/y');

    await expect(
      model.imageGeneration({ prompt: 'p', width: 1, height: 1 })
    ).rejects.toMatchObject({ code: 'AI_GENERATION_FAILED', message: expect.stringContaining('insufficient credits') });
  });

  it('maps an aborted fetch to TimeoutError', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    );

    const model = getImagesApiModel('x/y');

    await expect(
      model.imageGeneration({ prompt: 'p', width: 1, height: 1 })
    ).rejects.toMatchObject({ code: 'TIMEOUT_ERROR', statusCode: 504 });
  });
});
