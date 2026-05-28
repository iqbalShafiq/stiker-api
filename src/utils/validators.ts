import { z } from 'zod';
import { tryParseGridLayout } from './grid-layout';

const optionalPositiveInt = z.preprocess((val: unknown) => {
  if (val === '' || val === null || val === undefined) {
    return undefined;
  }
  return val;
}, z.coerce.number().int().positive().optional());

const optionalNonNegativeInt = z.preprocess((val: unknown) => {
  if (val === '' || val === null || val === undefined) {
    return undefined;
  }
  return val;
}, z.coerce.number().int().nonnegative().optional());

const oldGenerateGridFields = ['grid', 'rows', 'cols', 'layout', 'split', 'normalize'] as const;

const optionalBoundedPositiveInt = (max: number, fallback: number): z.ZodType<number> =>
  z.preprocess((val: unknown): unknown => {
    if (val === '' || val === null || val === undefined) {
      return fallback;
    }
    return val;
  }, z.coerce.number().int().positive().max(max)) as z.ZodType<number>;

export const generateImageSchema = z
  .object({
    text: z.string().min(1).max(2000),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const rawData = data as Record<string, unknown>;
    for (const field of oldGenerateGridFields) {
      if (rawData[field] != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Use /generate/sticker-pack instead of ${field} on /generate`,
          path: [field],
        });
      }
    }
  });

export const generateStickerPackSchema = z
  .object({
    text: z.string().min(1).max(2000),
    rows: optionalPositiveInt,
    cols: optionalPositiveInt,
    layout: z.string().max(32).optional(),
  })
  .superRefine((data, ctx) => {
    const hasRowsCols =
      data.rows != null &&
      data.cols != null &&
      Number.isFinite(data.rows) &&
      Number.isFinite(data.cols) &&
      data.rows > 0 &&
      data.cols > 0;
    const layoutOk = tryParseGridLayout(data.layout) !== null;
    if (!hasRowsCols && !layoutOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Sticker pack requires layout (e.g. 4x4) or both rows and cols',
        path: ['layout'],
      });
    }
  });

export const generateVideoStickerPackSchema = z
  .object({
    candidateManifest: z.string().min(2),
    layout: z.literal('4x4').default('4x4'),
    candidateLayout: z.literal('4x4').default('4x4'),
    selectedStartMs: z.coerce.number().int().nonnegative(),
    selectedEndMs: z.coerce.number().int().positive(),
    sourceDurationMs: optionalNonNegativeInt,
    prompt: z.string().trim().max(1000).optional(),
    maxStaticStickers: optionalBoundedPositiveInt(16, 8),
    maxAnimatedStickers: optionalBoundedPositiveInt(4, 2),
  })
  .superRefine((data, ctx) => {
    if (data.selectedEndMs <= data.selectedStartMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selectedEndMs must be greater than selectedStartMs',
        path: ['selectedEndMs'],
      });
    }
    if (data.sourceDurationMs != null && data.sourceDurationMs > 0 && data.selectedEndMs > data.sourceDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selectedEndMs cannot exceed sourceDurationMs',
        path: ['selectedEndMs'],
      });
    }
  });

export const gridSplitSchema = z.object({
  image: z.instanceof(Buffer).or(z.any()).refine(
    (file: unknown) => {
      if (!file || typeof file !== 'object') return false;
      const f = file as { mimetype?: string };
      return f.mimetype?.startsWith('image/') ?? false;
    },
    {
      message: 'File must be an image',
    }
  ),
});

export const removeBackgroundSchema = z.object({
  image: z.instanceof(Buffer).or(z.any()).refine(
    (file: unknown) => {
      if (!file || typeof file !== 'object') return false;
      const f = file as { mimetype?: string };
      return f.mimetype?.startsWith('image/') ?? false;
    },
    {
      message: 'File must be an image',
    }
  ),
});

export type GenerateImageInput = z.infer<typeof generateImageSchema>;
export type GenerateStickerPackInput = z.infer<typeof generateStickerPackSchema>;
export type GenerateVideoStickerPackInput = z.infer<typeof generateVideoStickerPackSchema>;
export type GridSplitInput = z.infer<typeof gridSplitSchema>;
export type RemoveBackgroundInput = z.infer<typeof removeBackgroundSchema>;
