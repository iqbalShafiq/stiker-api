import { z } from 'zod';
import { tryParseGridLayout } from './grid-layout';

const boolishGrid = z
  .union([z.boolean(), z.string()])
  .optional()
  .default(false)
  .transform((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      return val === 'true' || val === '1' || val === 'yes';
    }
    return false;
  });

const boolishNormalize = z
  .union([z.boolean(), z.string()])
  .optional()
  .default(false)
  .transform((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      return val === 'true' || val === '1' || val === 'yes';
    }
    return false;
  });

const optionalPositiveInt = z.preprocess((val: unknown) => {
  if (val === '' || val === null || val === undefined) {
    return undefined;
  }
  return val;
}, z.coerce.number().int().positive().optional());

export const generateImageSchema = z
  .object({
    text: z.string().min(1).max(2000),
    grid: boolishGrid,
    rows: optionalPositiveInt,
    cols: optionalPositiveInt,
    layout: z.string().max(32).optional(),
    normalize: boolishNormalize,
  })
  .superRefine((data, ctx) => {
    if (!data.grid) {
      return;
    }
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
        message:
          'When grid is true, provide layout (e.g. 4x4) or both rows and cols',
        path: ['layout'],
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
export type GridSplitInput = z.infer<typeof gridSplitSchema>;
export type RemoveBackgroundInput = z.infer<typeof removeBackgroundSchema>;
