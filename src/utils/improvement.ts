import { z } from 'zod';
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

/** Model-facing schema for the improvement prompt planner (validated by Anvia before returning). */
export const improvementPlanOutputSchema = z.object({
  improvementPrompt: z.string().trim().min(1).max(4000),
  textAssetDecoration: z
    .object({
      text: z.string().trim().min(1).max(64),
      style: z.object({
        fontFamily: z.string().trim().min(1).max(80),
        color: z.string().trim().min(1).max(40),
        weight: z.string().trim().min(1).max(40),
      }),
    })
    .optional(),
});

export function normalizeImprovementPromptPlan(
  content: unknown,
  options: { allowTextAssetDecoration: boolean }
): ImprovementPromptPlan {
  const parsed =
    typeof content === 'string'
      ? parseJsonObject(content)
      : isRecord(content)
        ? content
        : {};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
