import { z } from 'zod';
import { tryParseGridLayout } from './grid-layout';
import {
  VIDEO_STICKER_PACK_INPUT_LAYOUT,
  VIDEO_STICKER_PACK_MAX_CANDIDATES,
  VIDEO_STICKER_PACK_MAX_SEGMENT_MS,
  VIDEO_STICKER_PACK_OUTPUT_LAYOUT,
} from './video-sticker-pack';

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
    layout: z.string().max(32).default(VIDEO_STICKER_PACK_OUTPUT_LAYOUT),
    candidateLayout: z.string().max(32).default(VIDEO_STICKER_PACK_INPUT_LAYOUT),
    candidateCount: z.coerce.number().int().min(1).max(VIDEO_STICKER_PACK_MAX_CANDIDATES),
    selectedStartMs: z.coerce.number().int().nonnegative(),
    selectedEndMs: z.coerce.number().int().positive(),
    sourceDurationMs: optionalNonNegativeInt,
    prompt: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.layout !== VIDEO_STICKER_PACK_OUTPUT_LAYOUT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Video sticker pack output layout must be 4x4 for MVP',
        path: ['layout'],
      });
    }
    if (data.candidateLayout !== VIDEO_STICKER_PACK_INPUT_LAYOUT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Video sticker pack candidate layout must be 4x4 for MVP',
        path: ['candidateLayout'],
      });
    }
    if (data.selectedEndMs <= data.selectedStartMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selectedEndMs must be greater than selectedStartMs',
        path: ['selectedEndMs'],
      });
    }
    if (data.selectedEndMs - data.selectedStartMs > VIDEO_STICKER_PACK_MAX_SEGMENT_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selected video segment must be at most 60000 ms',
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
