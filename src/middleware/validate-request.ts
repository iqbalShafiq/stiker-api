import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { buildErrorResponse } from '../utils/response-builder';

export function validateRequest<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data: unknown = {
        ...req.body,
        ...req.file,
      };

      const parsed = schema.parse(data);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(req.body, parsed);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(
          buildErrorResponse(
            'VALIDATION_ERROR',
            'Request validation failed',
            error.issues
          )
        );
        return;
      }
      next(error);
    }
  };
}
