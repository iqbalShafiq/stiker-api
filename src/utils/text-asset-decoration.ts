import { z } from 'zod';
import type {
  TextAssetDecoration,
  TextDecorationStyle,
  TextOutsideForeground,
} from '../types';

const DEFAULT_STYLE: TextDecorationStyle = {
  fontFamily: 'sans-serif',
  color: '#FFFFFF',
  weight: 'regular',
};

/**
 * Model-facing schema for per-cell caption detection. String fields allow empty
 * values on purpose: the service drops incomplete detections (recall-first),
 * matching the previous tolerant parsing behavior.
 */
export const cellTextAnalysisOutputSchema = z.object({
  hasTextOutsideForeground: z.boolean(),
  textOutsideForeground: z
    .array(
      z.object({
        text: z.string().trim().max(120),
        style: z.object({
          fontFamily: z.string().trim().max(80),
          color: z.string().trim().max(40),
          weight: z.string().trim().max(40),
        }),
      })
    )
    .max(16),
});

export type CellTextAnalysisResult = z.infer<typeof cellTextAnalysisOutputSchema>;
export type OutsideForegroundTextDetection = CellTextAnalysisResult['textOutsideForeground'][number];

export function buildEmptyTextAssetDecoration(
  source: TextAssetDecoration['source'] = 'detected',
  text: string = ''
): TextAssetDecoration {
  return {
    text: text.trim(),
    style: { ...DEFAULT_STYLE },
    source,
  };
}

export function normalizeTextDecorationStyle(style: unknown): TextDecorationStyle {
  const maybeStyle = style as Partial<TextDecorationStyle> | undefined;
  const fontFamily =
    typeof maybeStyle?.fontFamily === 'string' && maybeStyle.fontFamily.trim()
      ? maybeStyle.fontFamily.trim()
      : DEFAULT_STYLE.fontFamily;
  const color =
    typeof maybeStyle?.color === 'string' && maybeStyle.color.trim()
      ? maybeStyle.color.trim()
      : DEFAULT_STYLE.color;
  const weight =
    typeof maybeStyle?.weight === 'string' && maybeStyle.weight.trim()
      ? maybeStyle.weight.trim()
      : DEFAULT_STYLE.weight;

  return { fontFamily, color, weight };
}

export function buildTextAssetDecoration(
  input: unknown,
  source: TextAssetDecoration['source'] = 'detected'
): TextAssetDecoration | undefined {
  const maybeInput = input as Partial<TextAssetDecoration> | undefined;
  const text =
    typeof maybeInput?.text === 'string'
      ? maybeInput.text.replace(/\s+/g, ' ').trim()
      : '';

  if (!text) {
    return undefined;
  }

  return {
    text,
    style: normalizeTextDecorationStyle(maybeInput?.style),
    source,
  };
}

export function textOutsideForegroundToAsset(
  input: TextOutsideForeground | undefined,
  source: TextAssetDecoration['source'] = 'detected'
): TextAssetDecoration | undefined {
  if (!input) {
    return undefined;
  }

  return buildTextAssetDecoration(input, source);
}
