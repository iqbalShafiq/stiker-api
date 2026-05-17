import { prisma } from '../prisma/client';
import { Prisma } from '@prisma/client';
import { NotFoundError, ValidationError } from '../errors';

export interface CreateHistoryInput {
  userId: string;
  type: 'generate' | 'grid-split' | 'background-remove';
  inputData?: Record<string, unknown>;
  outputFiles: Array<{
    url: string;
    path: string;
    filename: string;
    width?: number;
    height?: number;
  }>;
}

export class ProcessingHistoryService {
  private assertValidType(type?: string): void {
    if (type && !['generate', 'grid-split', 'background-remove'].includes(type)) {
      throw new ValidationError('Invalid processing history type');
    }
  }

  async create(input: CreateHistoryInput): Promise<void> {
    const expirationDays = parseInt(process.env.HISTORY_EXPIRATION_DAYS ?? '7', 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expirationDays);

    await prisma.processingHistory.create({
      data: {
        userId: input.userId,
        type: input.type,
        inputData: input.inputData ? (input.inputData as Prisma.InputJsonValue) : Prisma.JsonNull,
        outputFiles: input.outputFiles as Prisma.InputJsonValue,
        expiresAt,
      },
    });
  }

  async findByUser(userId: string, type?: string): Promise<Prisma.ProcessingHistoryGetPayload<object>[]> {
    this.assertValidType(type);

    return prisma.processingHistory.findMany({
      where: {
        userId,
        ...(type && { type }),
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async deleteByUser(id: string, userId: string): Promise<void> {
    const result = await prisma.processingHistory.deleteMany({
      where: {
        id,
        userId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundError('Processing history not found');
    }
  }

  async clearByUser(userId: string, type?: string): Promise<number> {
    this.assertValidType(type);

    const result = await prisma.processingHistory.deleteMany({
      where: {
        userId,
        ...(type && { type }),
      },
    });

    return result.count;
  }

  async findExpired(): Promise<Prisma.ProcessingHistoryGetPayload<object>[]> {
    return prisma.processingHistory.findMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
      },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await prisma.processingHistory.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    return result.count;
  }
}
