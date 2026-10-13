import type { StandardSchemaV1, UserMessage } from '@anvia/core';
import { getCompletionModelForRole } from './provider/completion-model';
import { anviaCore } from './core';
import { toAiError } from './errors';

export type CompletionRole = 'agent' | 'vision' | 'improvement';

export interface UserContentImage {
  buffer: Buffer;
  mimeType: string;
}

export interface StructuredCompletionInput<Output> {
  role: CompletionRole;
  instructions: string;
  prompt: string;
  images?: ReadonlyArray<UserContentImage>;
  outputSchema: StandardSchemaV1<unknown, Output>;
  timeoutMs: number;
}

export interface StructuredCompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredCompletionResult<Output> {
  output: Output;
  usage: StructuredCompletionUsage;
  cost?: number;
  latencyMs: number;
  model: string;
}

export function normalizeImageMediaType(mimeType: string): string {
  return /^image\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'image/png';
}

export function buildUserContent(input: {
  text: string;
  images?: ReadonlyArray<UserContentImage>;
}): UserMessage['content'] {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: { type: 'data'; data: string }; mediaType: string }
  > = [{ type: 'text', text: input.text }];

  for (const image of input.images ?? []) {
    content.push({
      type: 'image',
      image: { type: 'data', data: image.buffer.toString('base64') },
      mediaType: normalizeImageMediaType(image.mimeType),
    });
  }

  return content;
}

export async function generateStructuredCompletion<Output>(
  input: StructuredCompletionInput<Output>
): Promise<StructuredCompletionResult<Output>> {
  const [{ generateCompletion }, binding] = await Promise.all([
    anviaCore(),
    getCompletionModelForRole(input.role),
  ]);

  const abortSignal = AbortSignal.timeout(input.timeoutMs);
  const startedAt = Date.now();

  try {
    const result = await generateCompletion({
      model: binding.model,
      instructions: input.instructions,
      messages: [
        {
          role: 'user',
          content: buildUserContent({ text: input.prompt, images: input.images }),
        },
      ],
      outputSchema: input.outputSchema,
      ...(binding.temperature !== null ? { temperature: binding.temperature } : {}),
      ...(binding.maxTokens !== null ? { maxTokens: binding.maxTokens } : {}),
      ...(binding.reasoningEffort
        ? { controls: { reasoningEffort: binding.reasoningEffort } }
        : {}),
      abortSignal,
    });

    const cost = extractOpenRouterCost(result.rawResponse);

    return {
      output: result.output,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      ...(cost !== undefined ? { cost } : {}),
      latencyMs: Date.now() - startedAt,
      model: binding.modelId,
    };
  } catch (error) {
    throw toAiError(error, { abortSignal });
  }
}

function extractOpenRouterCost(rawResponse: unknown): number | undefined {
  const response = rawResponse as
    | { usage?: { cost?: number }; cost?: number }
    | null
    | undefined;
  return response?.usage?.cost ?? response?.cost;
}
