import OpenAI from 'openai';
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResult,
  JsonObject,
  ModelCallOptions,
} from '@anvia/core';
import { config } from '../config';
import { AIGenerationError } from '../errors';
import { toAiError } from './errors';
import { OPENROUTER_BASE_URL } from './openrouter';

export interface ReferenceImageInput {
  base64: string;
  mimeType: string;
}

const REFERENCE_IMAGES_KEY = 'referenceImages';

let imageClient: OpenAI | undefined;

function getImageClient(): OpenAI {
  imageClient ??= new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: config.openRouterApiKey,
    defaultHeaders: {
      'HTTP-Referer': config.appUrl,
      'X-Title': 'Setiker API',
    },
    timeout: 60000,
  });
  return imageClient;
}

export function buildReferenceImagesProviderOptions(
  images: ReadonlyArray<ReferenceImageInput>
): JsonObject | undefined {
  if (images.length === 0) {
    return undefined;
  }
  return {
    [REFERENCE_IMAGES_KEY]: images.map((image) => ({
      base64: image.base64,
      mimeType: image.mimeType,
    })),
  };
}

function readReferenceImages(providerOptions: JsonObject | undefined): ReferenceImageInput[] {
  const raw = providerOptions?.[REFERENCE_IMAGES_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const images: ReferenceImageInput[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.base64 === 'string' && typeof record.mimeType === 'string') {
      images.push({ base64: record.base64, mimeType: record.mimeType });
    }
  }
  return images;
}

const imageModelCache = new Map<string, ImageGenerationModel<unknown>>();

/**
 * Anvia ImageGenerationModel backed by OpenRouter's chat-image models
 * (image output arrives in `message.images[]` of a chat completion).
 */
export function getOpenRouterImageModel(modelId: string): ImageGenerationModel<unknown> {
  const cached = imageModelCache.get(modelId);
  if (cached !== undefined) {
    return cached;
  }

  const model: ImageGenerationModel<unknown> = {
    provider: 'openrouter',
    modelId,
    async imageGeneration(
      request: ImageGenerationRequest,
      options?: ModelCallOptions
    ): Promise<ImageGenerationResult<unknown>> {
      const referenceImages = readReferenceImages(request.providerOptions);
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: request.prompt },
      ];
      for (const image of referenceImages) {
        const mime = /^image\/[a-z0-9.+-]+$/i.test(image.mimeType)
          ? image.mimeType
          : 'image/png';
        content.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${image.base64}` },
        });
      }

      try {
        const response = await getImageClient().chat.completions.create(
          {
            model: modelId,
            messages: [
              {
                role: 'user',
                content: content as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[],
              },
            ],
          },
          { signal: options?.abortSignal, maxRetries: 0 }
        );

        const message = response.choices[0]?.message;
        const images = await extractImagesFromAssistantMessage(message);

        return { images, rawResponse: response };
      } catch (error) {
        throw toAiError(error, { abortSignal: options?.abortSignal });
      }
    },
  };

  imageModelCache.set(modelId, model);
  return model;
}

/**
 * Decodes image payloads from an OpenRouter chat-image assistant message:
 * `images[]` entries (data URL / raw base64 / b64_json / http URL) and
 * markdown/data-URL images embedded in `content` strings.
 */
export async function extractImagesFromAssistantMessage(
  message: unknown
): Promise<readonly [GeneratedImage, ...GeneratedImage[]]> {
  const assistantMsg = message as {
    images?: unknown;
    content?: unknown;
  };

  const decodeCandidates = async (value: unknown): Promise<Buffer | null> => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return tryDecodeFromString(value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const fromItem = await decodeCandidates(item);
        if (fromItem) {
          return fromItem;
        }
      }
      return null;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const directFields = [
        obj.image_url,
        obj.url,
        obj.b64_json,
        obj.image_base64,
        obj.base64,
        obj.data,
      ];
      for (const field of directFields) {
        const fromField = await decodeCandidates(field);
        if (fromField) {
          return fromField;
        }
      }
    }
    return null;
  };

  const fromImages = await decodeCandidates(assistantMsg.images);
  if (fromImages) {
    return [{ data: fromImages, mediaType: 'image/png' }];
  }

  const fromContent = await decodeCandidates(assistantMsg.content);
  if (fromContent) {
    return [{ data: fromContent, mediaType: 'image/png' }];
  }

  throw new AIGenerationError('No image data in response');
}

async function tryDecodeFromString(value: string): Promise<Buffer | null> {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('data:image')) {
    return decodeImageUrl(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return decodeImageUrl(trimmed);
  }

  const dataUriMatch = trimmed.match(/data:image\/[^;]+;base64,([^"\s)]+)/i);
  if (dataUriMatch?.[1]) {
    return Buffer.from(dataUriMatch[1], 'base64');
  }

  const markdownUrlMatch = trimmed.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownUrlMatch?.[1]) {
    return decodeImageUrl(markdownUrlMatch[1]);
  }

  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 128) {
    try {
      return Buffer.from(trimmed, 'base64');
    } catch {
      return null;
    }
  }

  return null;
}

async function decodeImageUrl(url: string): Promise<Buffer> {
  if (url.startsWith('data:image')) {
    const match = url.match(/data:image\/[^;]+;base64,([^"\s]+)/);
    if (match?.[1]) {
      return Buffer.from(match[1], 'base64');
    }
    throw new AIGenerationError('Invalid base64 image data');
  }

  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new AIGenerationError(`Failed to fetch generated image URL: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes);
  }

  throw new AIGenerationError('Unsupported image URL format');
}
