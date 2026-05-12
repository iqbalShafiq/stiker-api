export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Request validation failed') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class InvalidFileTypeError extends AppError {
  constructor(message: string = 'Only PNG, JPG, JPEG, WebP, and GIF are allowed') {
    super(message, 415, 'INVALID_FILE_TYPE');
  }
}

export class FileTooLargeError extends AppError {
  constructor(message: string = 'File size exceeds the maximum allowed size') {
    super(message, 413, 'FILE_TOO_LARGE');
  }
}

export class AIGenerationError extends AppError {
  constructor(message: string = 'AI generation failed') {
    super(message, 502, 'AI_GENERATION_FAILED');
  }
}

export class GridDetectionError extends AppError {
  constructor(message: string = 'Grid detection failed') {
    super(message, 422, 'GRID_DETECTION_FAILED');
  }
}

export class BackgroundRemovalError extends AppError {
  constructor(message: string = 'Background removal failed') {
    super(message, 500, 'BACKGROUND_REMOVAL_FAILED');
  }
}

export class ProviderError extends AppError {
  constructor(message: string = 'AI provider returned an error') {
    super(message, 502, 'PROVIDER_ERROR');
  }
}

export class TimeoutError extends AppError {
  constructor(message: string = 'Request timed out') {
    super(message, 504, 'TIMEOUT_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED');
  }
}
