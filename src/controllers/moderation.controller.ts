import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../prisma/client';
import { accountDeletionRequestService } from '../services/account-deletion-request.service';
import { AuthService } from '../services/auth.service';
import { contentReportService } from '../services/content-report.service';
import { userBlockService } from '../services/user-block.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

const authService = new AuthService();

export class ModerationController {
  async submitAccountDeletionRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const email = String(body.email ?? '');
      const reason = body.reason != null ? String(body.reason) : undefined;
      const confirmed = body.confirmed === true || body.confirmed === 'true';

      const result = await accountDeletionRequestService.submitWebRequest({
        email,
        reason,
        confirmed,
        ip: req.ip,
      });

      res.status(201).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async reportPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason, details } = req.body as Record<string, unknown>;
      if (!reason) throw new ValidationError('reason is required');

      const report = await contentReportService.reportPack(id, {
        reporterId: req.user!.id,
        reason: String(reason),
        details: details != null ? String(details) : undefined,
        packId: id,
      });

      res.status(201).json(buildSuccessResponse({ id: report.id, message: 'Report submitted' }));
    } catch (error) {
      next(error);
    }
  }

  async reportProcessingHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason, details } = req.body as Record<string, unknown>;
      if (!reason) throw new ValidationError('reason is required');

      const report = await contentReportService.reportAiOutput({
        reporterId: req.user!.id,
        reason: String(reason),
        details: details != null ? String(details) : undefined,
        processingHistoryId: id,
      });

      res.status(201).json(buildSuccessResponse({ id: report.id, message: 'Report submitted' }));
    } catch (error) {
      next(error);
    }
  }

  async blockUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await userBlockService.blockUser(req.user!.id, id);
      res.status(200).json(buildSuccessResponse({ message: 'User blocked' }));
    } catch (error) {
      next(error);
    }
  }

  async unblockUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await userBlockService.unblockUser(req.user!.id, id);
      res.status(200).json(buildSuccessResponse({ message: 'User unblocked' }));
    } catch (error) {
      next(error);
    }
  }

  async listBlockedUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await userBlockService.listBlockedUsers(req.user!.id);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async listContentReports(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const reports = await contentReportService.listOpen();
      res.status(200).json(buildSuccessResponse(reports));
    } catch (error) {
      next(error);
    }
  }

  async reviewContentReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body as Record<string, unknown>;
      if (!status || typeof status !== 'string') {
        throw new ValidationError('status is required');
      }
      await contentReportService.reviewReport(id, status as 'OPEN' | 'REVIEWED' | 'ACTION_TAKEN' | 'DISMISSED');
      res.status(200).json(buildSuccessResponse({ message: 'Report updated' }));
    } catch (error) {
      next(error);
    }
  }

  async listAccountDeletionRequests(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const requests = await accountDeletionRequestService.listPending();
      res.status(200).json(buildSuccessResponse(requests));
    } catch (error) {
      next(error);
    }
  }

  async processAccountDeletionRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body as Record<string, unknown>;
      if (status !== 'PROCESSED' && status !== 'REJECTED') {
        throw new ValidationError('status must be PROCESSED or REJECTED');
      }
      if (status === 'PROCESSED') {
        const pending = await prisma.accountDeletionRequest.findUnique({ where: { id } });
        if (pending?.userId) {
          await authService.performAccountDeletionInternal(pending.userId);
        }
      }
      await accountDeletionRequestService.markProcessed(id, status);
      res.status(200).json(buildSuccessResponse({ message: 'Deletion request updated' }));
    } catch (error) {
      next(error);
    }
  }
}

export const moderationController = new ModerationController();
