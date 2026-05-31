import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { ValidationError } from '../errors';
import { buildSuccessResponse } from '../utils/response-builder';
import {
  aiUsageService,
  type AiOperation,
  type AiReservationOutcome,
  OPERATIONS,
} from '../services/ai-usage.service';

function parseOperation(value: unknown): AiOperation {
  if (typeof value !== 'string' || !OPERATIONS.includes(value as AiOperation)) {
    throw new ValidationError(
      `operation is required and must be one of: ${OPERATIONS.join(', ')}`
    );
  }
  return value as AiOperation;
}

function parseOutcome(value: unknown): AiReservationOutcome {
  if (value === 'committed' || value === 'released') {
    return value;
  }
  throw new ValidationError("outcome must be 'committed' or 'released'");
}

export class AiQuotaController {
  async reserve(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const body = req.body as Record<string, unknown>;
      const operation = parseOperation(body.operation);
      const result = await aiUsageService.reserve(req.user.id, operation);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async finalize(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const body = req.body as Record<string, unknown>;
      const reservationId = body.reservationId;
      if (typeof reservationId !== 'string' || !reservationId.trim()) {
        throw new ValidationError('reservationId is required');
      }
      const outcome = parseOutcome(body.outcome);
      const result = await aiUsageService.finalize(
        reservationId.trim(),
        outcome,
        req.user.id
      );
      const usage = await aiUsageService.getUsage(req.user.id);
      res.status(200).json(
        buildSuccessResponse({
          reservationId: reservationId.trim(),
          outcome,
          result,
          usage,
          serverNow: usage.serverNow,
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
