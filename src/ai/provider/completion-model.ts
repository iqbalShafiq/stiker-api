import type { CompletionModel } from '@anvia/core';
import { loadAiModel, type AiModelRole } from '../models/catalog';
import { explicitControls, resolveReasoningEffort } from '../models/controls';
import { getCompletionModel } from './client';

export interface CompletionModelBinding {
  modelId: string;
  model: CompletionModel;
  reasoningEffort: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

const bindings = new Map<AiModelRole, Promise<CompletionModelBinding>>();

/** Builds (once per process) the provider model bound to a catalog role. */
export function getCompletionModelForRole(role: AiModelRole): Promise<CompletionModelBinding> {
  const existing = bindings.get(role);
  if (existing) {
    return existing;
  }
  const binding = (async (): Promise<CompletionModelBinding> => {
    const row = await loadAiModel(role);
    const model = await getCompletionModel(row.modelId, explicitControls(row.reasoningEfforts));
    return {
      modelId: row.modelId,
      model,
      reasoningEffort: resolveReasoningEffort(row),
      temperature: row.temperature,
      maxTokens: row.maxTokens,
    };
  })().catch((error: unknown) => {
    // A transient failure must not disable the role for the process lifetime.
    bindings.delete(role);
    throw error;
  });
  bindings.set(role, binding);
  return binding;
}
