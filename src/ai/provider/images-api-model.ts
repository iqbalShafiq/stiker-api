import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResult,
  JsonObject,
  ModelCallOptions,
} from '@anvia/core';
import { AIGenerationError } from '../../errors';
import { toAiError } from '../errors';
import { requireAgentCredentials } from './client';

export interface ReferenceImageInput {
  base64: string;
  mimeType: string;
}

const REFERENCE_IMAGES_KEY = 'referenceImages';

export const IMAGE_API_SUPPORTED_ASPECT_RATIOS = [
  '1:1',
  '1:2',
  '2:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '9:21',
  '21:9',
  'auto',
] as const;

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

/** Nearest supported aspect-ratio string for a target size, or `auto` when none matches. */
export function aspectRatioFor(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  const candidate = `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
  return (IMAGE_API_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(candidate)
    ? candidate
    : 'auto';
}

const modelCache = new Map<string, ImageGenerationModel<unknown>>();

/** Anvia ImageGenerationModel for the OpenRouter Images API (`POST /images`). */
export function getImagesApiModel(modelId: string): ImageGenerationModel<unknown> {
  const cached = modelCache.get(modelId);
  if (cached !== undefined) {
    return cached;
  }

  const model: ImageGenerationModel<unknown> = {
    provider: 'openrouter-images',
    modelId,
    async imageGeneration(
      request: ImageGenerationRequest,
      options?: ModelCallOptions
    ): Promise<ImageGenerationResult<unknown>> {
      const { apiKey, baseUrl } = requireAgentCredentials();
      const referenceImages = readReferenceImages(request.providerOptions);
      const body: Record<string, unknown> = {
        model: modelId,
        prompt: request.prompt,
        n: 1,
        aspect_ratio: aspectRatioFor(request.width, request.height),
      };
      if (referenceImages.length > 0) {
        body.input_references = referenceImages.map((image) => ({
          type: 'image_url',
          image_url: {
            url: `data:${/^image\/[a-z0-9.+-]+$/i.test(image.mimeType) ? image.mimeType : 'image/png'};base64,${image.base64}`,
          },
        }));
      }

      try {
        const response = await fetch(`${baseUrl}/images`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: options?.abortSignal,
        });
        const payload = (await response.json()) as {
          data?: Array<{ b64_json?: string; media_type?: string }>;
          error?: { message?: string; code?: number };
        };
        if (!response.ok) {
          throw new AIGenerationError(
            payload.error?.message ?? `Images API failed with ${response.status}`
          );
        }
        const first = payload.data?.[0];
        if (!first?.b64_json) {
          throw new AIGenerationError('Images API returned no image data');
        }
        const image: GeneratedImage = {
          data: Buffer.from(first.b64_json, 'base64'),
          mediaType: first.media_type ?? 'image/png',
        };
        return { images: [image], rawResponse: payload };
      } catch (error) {
        throw toAiError(error, { abortSignal: options?.abortSignal });
      }
    },
  };

  modelCache.set(modelId, model);
  return model;
}
