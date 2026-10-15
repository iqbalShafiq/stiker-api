import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import logger from '../utils/logger';
import { buildErrorResponse } from '../utils/response-builder';
import { AppError } from '../errors';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error({ err: err.message, stack: err.stack }, `[ERROR] ${err.name}: ${err.message}`);

  // Handle custom AppErrors
  if (err instanceof AppError) {
    res.status(err.statusCode).json(
      buildErrorResponse(
        err.code,
        err.message,
        err.details,
        undefined,
        err.subcode
      )
    );
    return;
  }

  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(
        buildErrorResponse('FILE_TOO_LARGE', 'File size exceeds the maximum allowed size')
      );
      return;
    }
  }

  res.status(500).json(
    buildErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred')
  );
}
