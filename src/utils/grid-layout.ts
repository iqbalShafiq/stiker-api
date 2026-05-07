import { ValidationError } from '../errors';

const LAYOUT_RE = /^(\d+)\s*[x×]\s*(\d+)$/i;

export function tryParseGridLayout(layout: string | undefined): { rows: number; cols: number } | null {
  if (!layout || typeof layout !== 'string') {
    return null;
  }
  const m = layout.trim().match(LAYOUT_RE);
  if (!m) {
    return null;
  }
  const rows = parseInt(m[1], 10);
  const cols = parseInt(m[2], 10);
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
    return null;
  }
  return { rows, cols };
}

/**
 * Resolves rows/cols from explicit fields or `layout` like `4x4`. Explicit rows+cols win over layout.
 */
export function resolveGridRowsCols(input: {
  rows?: number;
  cols?: number;
  layout?: string;
}): { rows: number; cols: number } {
  if (
    typeof input.rows === 'number' &&
    Number.isFinite(input.rows) &&
    input.rows > 0 &&
    typeof input.cols === 'number' &&
    Number.isFinite(input.cols) &&
    input.cols > 0
  ) {
    return { rows: Math.floor(input.rows), cols: Math.floor(input.cols) };
  }

  const fromLayout = tryParseGridLayout(input.layout);
  if (fromLayout) {
    return fromLayout;
  }

  throw new ValidationError(
    'Grid requires layout (e.g. 4x4) or both rows and cols as positive integers'
  );
}
