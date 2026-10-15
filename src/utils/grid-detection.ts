import { z } from 'zod';
import type { GridDetectionResult } from '../types';

/** Model-facing schema for AI grid boundary detection (validated locally by Anvia too). */
export const gridDetectionOutputSchema: z.ZodType<GridDetectionResult> = z.object({
  gridLayout: z
    .string()
    .trim()
    .regex(/^\d{1,2}\s*[x×]\s*\d{1,2}$/i),
  boundaries: z
    .array(
      z.object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
    )
    .min(1),
});
