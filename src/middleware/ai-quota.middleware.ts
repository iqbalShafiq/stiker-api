import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware';
import { UnauthorizedError } from '../errors';
import { logger } from '../utils/logger';
import { aiUsageService, type AiOperation } from '../services/ai-usage.service';

export const AI_RESERVATION_HEADER = 'x-ai-reservation-id';

export function requireAiQuota(operation: AiOperation) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      if (!req.user?.id) {
        return next(new UnauthorizedError('Authentication required', 'UNAUTHORIZED'));
      }

      const headerReservation = req.header(AI_RESERVATION_HEADER)?.trim();
      let reservationId: string;

      if (headerReservation) {
        await aiUsageService.validateReservation(req.user.id, headerReservation, operation);
        reservationId = headerReservation;
      } else {
        reservationId = await aiUsageService.reserveForRequest(req.user.id, operation);
      }

      res.locals.aiReservationId = reservationId;
      res.locals.aiQuotaFinalized = false;

      res.on('finish', () => {
        if (res.locals.aiQuotaFinalized) {
          return;
        }
        const id = res.locals.aiReservationId as string | undefined;
        if (!id) {
          return;
        }
        const outcome = res.statusCode >= 200 && res.statusCode < 300 ? 'committed' : 'released';
        void aiUsageService.finalize(id, outcome, req.user?.id).then((result) => {
          if (result === 'applied' || result === 'already_finalized') {
            res.locals.aiQuotaFinalized = true;
          }
        }).catch((error: unknown) => {
          logger.warn({ err: error, reservationId: id, outcome }, 'AI quota auto-finalize failed');
        });
      });

      next();
    })().catch(next);
  };
}

/** Call when the client already finalized (e.g. cancel commit) to avoid double finalize on finish. */
export function markAiQuotaFinalized(res: Response): void {
  res.locals.aiQuotaFinalized = true;
}
