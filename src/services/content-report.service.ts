import {
  ContentReportReason,
  ContentReportStatus,
  ContentReportTarget,
  StickerVisibility,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../prisma/client';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';

const VALID_REASONS = new Set<string>(Object.values(ContentReportReason));

export interface SubmitReportInput {
  reporterId: string;
  reason: string;
  details?: string;
  packId?: string;
  processingHistoryId?: string;
  aiJobId?: string;
}

export class ContentReportService {
  async reportPack(
    packId: string,
    input: SubmitReportInput,
  ): Promise<Prisma.ContentReportGetPayload<object>> {

    const pack = await prisma.stickerPack.findFirst({
      where: { id: packId, deletedAt: null },
    });
    if (!pack) throw new NotFoundError('Sticker pack not found');
    if (pack.visibility !== StickerVisibility.PUBLIC) {
      throw new ForbiddenError('Only public packs can be reported');
    }
    if (pack.ownerId === input.reporterId) {
      throw new ForbiddenError('You cannot report your own pack');
    }
    return this.createReport({
      ...input,
      targetType: ContentReportTarget.STICKER_PACK,
      packId,
    });
  }

  async reportAiOutput(
    input: SubmitReportInput & { processingHistoryId?: string; aiJobId?: string },
  ): Promise<Prisma.ContentReportGetPayload<object>> {

    if (!input.processingHistoryId && !input.aiJobId) {
      throw new ValidationError('processingHistoryId or aiJobId is required');
    }

    if (input.processingHistoryId) {
      const history = await prisma.processingHistory.findFirst({
        where: { id: input.processingHistoryId, userId: input.reporterId },
      });
      if (!history) throw new NotFoundError('Processing history not found');
    }

    return this.createReport({
      ...input,
      targetType: ContentReportTarget.AI_OUTPUT,
      processingHistoryId: input.processingHistoryId,
      aiJobId: input.aiJobId,
    });
  }

  private async createReport(input: SubmitReportInput & {
    targetType: ContentReportTarget;
    packId?: string;
    processingHistoryId?: string | null;
    aiJobId?: string | null;
  }): Promise<Prisma.ContentReportGetPayload<object>> {

    if (!VALID_REASONS.has(input.reason)) {
      throw new ValidationError('Invalid report reason');
    }

    const details = input.details?.trim().slice(0, 2000) ?? null;

    const existing = await prisma.contentReport.findFirst({
      where: {
        reporterId: input.reporterId,
        targetType: input.targetType,
        ...(input.packId ? { packId: input.packId } : {}),
        ...(input.processingHistoryId ? { processingHistoryId: input.processingHistoryId } : {}),
      },
    });
    if (existing) {
      throw new ConflictError('You have already submitted a report for this content');
    }

    return prisma.contentReport.create({
      data: {
        targetType: input.targetType,
        packId: input.packId ?? null,
        processingHistoryId: input.processingHistoryId ?? null,
        aiJobId: input.aiJobId ?? null,
        reporterId: input.reporterId,
        reason: input.reason as ContentReportReason,
        details,
      },
    });
  }

  async listOpen(limit = 50): Promise<Prisma.ContentReportGetPayload<object>[]> {
    return prisma.contentReport.findMany({
      where: { status: ContentReportStatus.OPEN },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async reviewReport(id: string, status: ContentReportStatus): Promise<void> {
    const report = await prisma.contentReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundError('Report not found');

    await prisma.$transaction(async (tx) => {
      await tx.contentReport.update({
        where: { id },
        data: { status, reviewedAt: new Date() },
      });

      if (status === ContentReportStatus.ACTION_TAKEN && report.packId) {
        await tx.stickerPack.updateMany({
          where: { id: report.packId },
          data: { visibility: StickerVisibility.PRIVATE },
        });
      }
    });
  }
}

export const contentReportService = new ContentReportService();
