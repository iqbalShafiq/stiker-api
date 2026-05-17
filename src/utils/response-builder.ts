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

export function buildPaginatedSuccessResponse<T>(
  data: T,
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  },
  requestId?: string
): ApiResponse<T> & { meta: ApiResponse<T>['meta'] & { pagination: typeof pagination } } {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: requestId ?? uuidv4(),
      pagination,
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
