import { prisma } from '../prisma/client';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../errors';
import { logger } from '../utils/logger';

export type NotificationType =
  | 'LIKE'
  | 'SAVE'
  | 'FOLLOW'
  | 'PACK_IMPORT'
  | 'SHARE'
  | 'COLLAB_INVITE';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
}

export class NotificationService {
  async create(input: CreateNotificationInput): Promise<void> {
    try {
      await prisma.userNotification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          payload: input.payload ? (input.payload as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    } catch (error) {
      logger.warn({ err: error, userId: input.userId, type: input.type }, 'Failed to create notification');
    }
  }

  async list(userId: string, page = 1, limit = 20, unreadOnly = false) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const where = {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [total, data, unreadCount] = await prisma.$transaction([
      prisma.userNotification.count({ where }),
      prisma.userNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.userNotification.count({
        where: { userId, readAt: null },
      }),
    ]);

    return {
      data,
      unreadCount,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async markRead(id: string, userId: string): Promise<void> {
    const result = await prisma.userNotification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundError('Notification not found');
    }
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await prisma.userNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }
}

export const notificationService = new NotificationService();
