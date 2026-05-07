import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { config } from '../config';
import { buildErrorResponse } from '../utils/response-builder';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

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
      cb(new Error('INVALID_FILE_TYPE: Only PNG, JPG, JPEG, and WebP are allowed'));
    }
  },
});

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('ERROR:', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(
        buildErrorResponse('FILE_TOO_LARGE', 'File size exceeds the maximum allowed size')
      );
      return;
    }
  }

  if (err.message.startsWith('INVALID_FILE_TYPE')) {
    res.status(415).json(
      buildErrorResponse('INVALID_FILE_TYPE', err.message)
    );
    return;
  }

  if (err.message.startsWith('VALIDATION_ERROR')) {
    res.status(400).json(
      buildErrorResponse('VALIDATION_ERROR', err.message)
    );
    return;
  }

  if (err.message.startsWith('AI_GENERATION_FAILED')) {
    res.status(502).json(
      buildErrorResponse('AI_GENERATION_FAILED', err.message)
    );
    return;
  }

  if (err.message.startsWith('GRID_DETECTION_FAILED')) {
    res.status(422).json(
      buildErrorResponse('GRID_DETECTION_FAILED', err.message)
    );
    return;
  }

  if (err.message.startsWith('BACKGROUND_REMOVAL_FAILED')) {
    res.status(500).json(
      buildErrorResponse('BACKGROUND_REMOVAL_FAILED', err.message)
    );
    return;
  }

  res.status(500).json(
    buildErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred')
  );
}
