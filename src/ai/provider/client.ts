import type { CompletionModel, CompletionModelControls } from '@anvia/core';
import { config } from '../../config';
import { AiNotConfiguredError } from '../../errors';
import { importEsm } from '../esm';

type AnviaOpenAIModule = typeof import('@anvia/openai');

let openaiModulePromise: Promise<AnviaOpenAIModule> | undefined;

function anviaOpenAI(): Promise<AnviaOpenAIModule> {
  openaiModulePromise ??= importEsm<AnviaOpenAIModule>('@anvia/openai').catch((error: unknown) => {
    // A transient module-load failure must not disable the gateway for the process lifetime.
    openaiModulePromise = undefined;
    throw error;
  });
  return openaiModulePromise;
}

let clientPromise: Promise<InstanceType<AnviaOpenAIModule['OpenAIClient']>> | undefined;

function getClient(): Promise<InstanceType<AnviaOpenAIModule['OpenAIClient']>> {
  clientPromise ??= anviaOpenAI()
    .then(({ OpenAIClient }) => {
      const { apiKey, baseUrl } = requireAgentCredentials();
      return new OpenAIClient({
        apiKey,
        baseUrl,
        headers: {
          'HTTP-Referer': config.appUrl,
          'X-Title': config.legal.appName,
        },
      });
    })
    .catch((error: unknown) => {
      // A transient failure must not disable the gateway client for the process lifetime.
      clientPromise = undefined;
      throw error;
    });
  return clientPromise;
}

const modelCache = new Map<string, CompletionModel>();

/** Guard at the AI boundary: a missing gateway key is a configuration error, reported clearly. */
export function requireAgentCredentials(): { apiKey: string; baseUrl: string } {
  if (!config.agent.apiKey) {
    throw new AiNotConfiguredError('AGENT_API_KEY is required for AI features');
  }
  return { apiKey: config.agent.apiKey, baseUrl: config.agent.baseUrl };
}

export async function getCompletionModel(
  modelId: string,
  options?: { controls?: CompletionModelControls }
): Promise<CompletionModel> {
  const cacheKey = `${modelId}::${options?.controls ? JSON.stringify(options.controls) : 'plain'}`;
  const cached = modelCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const client = await getClient();
  // @typescript-eslint v7 cannot evaluate the `const` type parameter on
  // OpenAIClient.completionModel; both the call result and Parameters<> degrade
  // to an error type here, so this assignment is NOT type-checked by tsc either
  // (final review proved it — see migration ledger). The runtime contract is
  // owned by @anvia/openai and covered by the live smoke checklist.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- see note above
  const model: CompletionModel = client.completionModel({
    modelId,
    api: 'chat',
    ...(options?.controls ? { controls: options.controls } : {}),
  });
  modelCache.set(cacheKey, model);
  return model;
}
