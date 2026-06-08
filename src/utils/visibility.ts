import { StickerVisibility } from '@prisma/client';

function parseBooleanLike(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 0 || value === '0') {
    return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return undefined;
}

export function parseStickerVisibilityValue(value: unknown): StickerVisibility | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = String(value).trim().toUpperCase();
  if (Object.values(StickerVisibility).includes(normalized as StickerVisibility)) {
    return normalized as StickerVisibility;
  }

  return undefined;
}

export function parseStickerVisibilityInput(
  body: Record<string, unknown>,
  options?: { defaultVisibility?: StickerVisibility }
): StickerVisibility | undefined {
  const explicitVisibility = parseStickerVisibilityValue(body.visibility);
  if (explicitVisibility) {
    return explicitVisibility;
  }

  if (body.visibility !== undefined && body.visibility !== null && body.visibility !== '') {
    return undefined;
  }

  const isPublic = parseBooleanLike(body.isPublic ?? body.public);
  if (isPublic === true) {
    return StickerVisibility.PUBLIC;
  }
  if (isPublic === false) {
    return StickerVisibility.PRIVATE;
  }

  return options?.defaultVisibility;
}

export function hasStickerVisibilityInput(body: Record<string, unknown>): boolean {
  return (
    body.visibility !== undefined
    || body.isPublic !== undefined
    || body.public !== undefined
  );
}
