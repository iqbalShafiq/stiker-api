import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { config } from '../config';
import logger from '../utils/logger';
import { buildErrorResponse } from '../utils/response-builder';
import { AppError, InvalidFileTypeError } from '../errors';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSize,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new InvalidFileTypeError());
    }
  },
});

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
