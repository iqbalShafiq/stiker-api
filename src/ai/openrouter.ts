import type { CompletionModel } from '@anvia/core';
import type { OpenAIClient as OpenAIClientHandle } from '@anvia/openai';
import { config } from '../config';
import { importEsm } from './esm';

type AnviaOpenAIModule = typeof import('@anvia/openai');

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let openaiModulePromise: Promise<AnviaOpenAIModule> | undefined;

function anviaOpenAI(): Promise<AnviaOpenAIModule> {
  openaiModulePromise ??= importEsm<AnviaOpenAIModule>('@anvia/openai');
  return openaiModulePromise;
}

let clientPromise: Promise<OpenAIClientHandle> | undefined;

function getClient(): Promise<OpenAIClientHandle> {
  clientPromise ??= anviaOpenAI().then(
    ({ OpenAIClient }) =>
      new OpenAIClient({
        apiKey: config.openRouterApiKey,
        baseUrl: OPENROUTER_BASE_URL,
        headers: {
          'HTTP-Referer': config.appUrl,
          'X-Title': 'Setiker API',
        },
      })
  );
  return clientPromise;
}

const modelCache = new Map<string, CompletionModel>();

export async function getOpenRouterCompletionModel(modelId: string): Promise<CompletionModel> {
  const cached = modelCache.get(modelId);
  if (cached !== undefined) {
    return cached;
  }
  const client = await getClient();
  // @typescript-eslint v7 cannot evaluate the `const` type parameter on
  // OpenAIClient.completionModel (call result and Parameters<> degrade to an
  // error type); tsc validates this assignment with full type checking.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- see note above
  const model: CompletionModel = client.completionModel({ modelId, api: 'chat' });
  modelCache.set(modelId, model);
  return model;
}

export function getAgentCompletionModel(): Promise<CompletionModel> {
  return getOpenRouterCompletionModel(config.models.videoStickerPackAgent);
}

export function getVisionCompletionModel(): Promise<CompletionModel> {
  return getOpenRouterCompletionModel(config.models.agent);
}

export function getImprovementCompletionModel(): Promise<CompletionModel> {
  return getOpenRouterCompletionModel(config.models.improvementAgent);
}
