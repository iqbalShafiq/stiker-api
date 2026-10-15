import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../../../src/middleware/error-handler';
import { AIGenerationError, AppError, ValidationError } from '../../../src/errors';

function mockResponse(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const status = vi.fn();
  const json = vi.fn();
  const res = { status, json } as unknown as Response;
  status.mockReturnValue(res);
  return { res, status, json };
}

describe('errorHandler', () => {
  it('maps AppError instances to their status and code', () => {
    const { res, status, json } = mockResponse();

    errorHandler(new ValidationError('bad input'), {} as Request, res, vi.fn());

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'bad input' }),
      })
    );
  });

  it('maps AI taxonomy errors to their status codes', () => {
    const { res, status } = mockResponse();

    errorHandler(new AIGenerationError('generation exploded'), {} as Request, res, vi.fn());

    expect(status).toHaveBeenCalledWith(502);
  });

  it('no longer maps legacy string-prefix errors; they fall through to 500', () => {
    const { res, status, json } = mockResponse();
    const legacy = new Error('VALIDATION_ERROR: legacy shape');

    errorHandler(legacy, {} as Request, res, vi.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      })
    );
  });

  it('maps AppError subclasses through their own status codes', () => {
    const { res, status } = mockResponse();
    class PlainError extends AppError {
      constructor() {
        super('plain app error', 418, 'TEAPOT');
      }
    }

    errorHandler(new PlainError(), {} as Request, res, vi.fn());

    expect(status).toHaveBeenCalledWith(418);
  });
});
