import { describe, it, expect } from 'vitest';
import {
  buildSuccessResponse,
  buildErrorResponse,
} from '../../../src/utils/response-builder';

describe('response-builder', () => {
  describe('buildSuccessResponse', () => {
    it('should return a success response with data', () => {
      const data = { message: 'test' };
      const response = buildSuccessResponse(data);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response.meta).toBeDefined();
      expect(response.meta?.timestamp).toBeDefined();
      expect(response.meta?.requestId).toBeDefined();
    });

    it('should include custom requestId when provided', () => {
      const data = { message: 'test' };
      const requestId = 'custom-id';
      const response = buildSuccessResponse(data, requestId);

      expect(response.meta?.requestId).toBe(requestId);
    });
  });

  describe('buildErrorResponse', () => {
    it('should return an error response', () => {
      const code = 'TEST_ERROR';
      const message = 'Test error message';
      const response = buildErrorResponse(code, message);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(code);
      expect(response.error?.message).toBe(message);
      expect(response.meta).toBeDefined();
    });

    it('should include details when provided', () => {
      const code = 'TEST_ERROR';
      const message = 'Test error message';
      const details = { field: 'test' };
      const response = buildErrorResponse(code, message, details);

      expect(response.error?.details).toEqual(details);
    });
  });
});
