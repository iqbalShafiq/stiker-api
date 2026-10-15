import type { CompletionModelControls } from '@anvia/core';
import type { AiModelRow } from './catalog';

/**
 * Declares the reasoning-effort vocabulary so Anvia validates the value before
 * the provider call. Built as a literal (not `defineCompletionModelControls`)
 * because that helper is a value export of the ESM-only `@anvia/core`, which a
 * static import would turn into a failing `require()` in the compiled CJS build.
 */
export function explicitControls(efforts: readonly string[]): { controls?: CompletionModelControls } {
  if (efforts.length === 0) {
    return {};
  }
  const controls: CompletionModelControls = {
    reasoningEffort: {
      type: 'select',
      label: 'Reasoning effort',
      description: 'How much reasoning the model applies before answering.',
      options: [...efforts],
    },
  };
  return { controls };
}

/** The effort value to pass per run; null when the model declares none or the default is invalid. */
export function resolveReasoningEffort(row: AiModelRow): string | null {
  if (!row.defaultReasoningEffort) {
    return null;
  }
  return row.reasoningEfforts.includes(row.defaultReasoningEffort)
    ? row.defaultReasoningEffort
    : null;
}
