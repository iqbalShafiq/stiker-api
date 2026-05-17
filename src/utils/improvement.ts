import type { TextAssetDecoration } from '../types';
import { buildTextAssetDecoration } from './text-asset-decoration';

export const IMPROVEMENT_GRID_LAYOUT = '4x4';
export const IMPROVEMENT_GRID_MAX_CELLS = 16;

export interface ImageGenerationInput {
  buffer: Buffer;
  mimeType: string;
}

export interface ImprovementPromptPlan {
  improvementPrompt: string;
  textAssetDecoration?: TextAssetDecoration;
}

export function chunkImageInputs<T>(items: T[], chunkSize = IMPROVEMENT_GRID_MAX_CELLS): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export function normalizeImprovementPromptPlan(
  content: string,
  options: { allowTextAssetDecoration: boolean }
): ImprovementPromptPlan {
  const parsed = parseJsonObject(content);
  const prompt =
    typeof parsed.improvementPrompt === 'string'
      ? parsed.improvementPrompt.trim()
      : '';

  if (!prompt) {
    throw new Error('Improvement agent did not return improvementPrompt');
  }

  const textAssetDecoration = options.allowTextAssetDecoration
    ? buildTextAssetDecoration(parsed.textAssetDecoration, 'detected')
    : undefined;

  return {
    improvementPrompt: prompt,
    ...(textAssetDecoration ? { textAssetDecoration } : {}),
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(withoutFence) as Record<string, unknown>;
}
