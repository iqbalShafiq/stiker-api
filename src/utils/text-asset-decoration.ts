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
