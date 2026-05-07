import { z } from 'zod';

export const generateImageSchema = z.object({
  text: z.string().min(1).max(2000),
  grid: z.boolean().optional().default(false),
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
