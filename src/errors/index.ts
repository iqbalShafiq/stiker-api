export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly subcode?: string;
  public readonly details?: ErrorDetails;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    subcode?: string,
    details?: ErrorDetails
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.subcode = subcode;
    this.details = details;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Request validation failed', details?: ErrorDetails) {
    super(message, 400, 'VALIDATION_ERROR', 'VALIDATION_ERROR', details);
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
  constructor(
    message: string = 'Authentication required',
    subcode: string = 'UNAUTHORIZED',
    details?: ErrorDetails
  ) {
    super(message, 401, 'UNAUTHORIZED', subcode, details);
  }
}

export class InvalidCredentialsError extends UnauthorizedError {
  constructor(message: string = 'Invalid email or password') {
    super(message, 'INVALID_CREDENTIALS');
  }
}

export class AccountInactiveError extends UnauthorizedError {
  constructor(message: string = 'Account is deactivated') {
    super(message, 'ACCOUNT_INACTIVE');
  }
}

export class TokenExpiredError extends UnauthorizedError {
  constructor(message: string = 'Token has expired') {
    super(message, 'TOKEN_EXPIRED');
  }
}

export class TokenInvalidError extends UnauthorizedError {
  constructor(message: string = 'Invalid token') {
    super(message, 'TOKEN_INVALID');
  }
}

export class RefreshTokenMissingError extends AppError {
  constructor(message: string = 'Refresh token is required') {
    super(message, 400, 'VALIDATION_ERROR', 'REFRESH_TOKEN_MISSING');
  }
}

export class RefreshTokenInvalidError extends UnauthorizedError {
  constructor(message: string = 'Invalid refresh token') {
    super(message, 'REFRESH_TOKEN_INVALID');
  }
}

export class RefreshTokenNotFoundError extends UnauthorizedError {
  constructor(message: string = 'Refresh token not found') {
    super(message, 'REFRESH_TOKEN_NOT_FOUND');
  }
}

export class RefreshTokenExpiredError extends UnauthorizedError {
  constructor(message: string = 'Refresh token expired') {
    super(message, 'REFRESH_TOKEN_EXPIRED');
  }
}

export class CurrentPasswordIncorrectError extends UnauthorizedError {
  constructor(message: string = 'Current password is incorrect') {
    super(message, 'CURRENT_PASSWORD_INCORRECT');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string = 'Resource already exists',
    subcode: string = 'CONFLICT',
    details?: ErrorDetails
  ) {
    super(message, 409, 'CONFLICT', subcode, details);
  }
}

export class EmailAlreadyInUseError extends ConflictError {
  constructor(message: string = 'Email already in use') {
    super(message, 'EMAIL_ALREADY_IN_USE');
  }
}

export class UsernameAlreadyInUseError extends ConflictError {
  constructor(message: string = 'Username already in use') {
    super(message, 'USERNAME_ALREADY_IN_USE');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class RateLimitError extends AppError {
  constructor(
    message: string = 'Too many requests',
    subcode: string = 'RATE_LIMITED',
    details?: ErrorDetails
  ) {
    super(message, 429, 'RATE_LIMITED', subcode, details);
  }
}

export class AiDailyQuotaExceededError extends RateLimitError {
  constructor(message: string = 'Daily AI limit reached', details?: ErrorDetails) {
    super(message, 'AI_DAILY_QUOTA_EXCEEDED', details);
  }
}
