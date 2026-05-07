import { v4 as uuidv4 } from 'uuid';
import type { ApiResponse } from '../types';

export function buildSuccessResponse<T>(
  data: T,
  requestId?: string
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: requestId ?? uuidv4(),
    },
  };
}

export function buildErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  requestId?: string
): ApiResponse<never> {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: requestId ?? uuidv4(),
    },
  };
}
