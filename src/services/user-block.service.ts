import { prisma } from '../prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

export class UserBlockService {
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new ValidationError('You cannot block yourself');
    }

    const target = await prisma.user.findUnique({ where: { id: blockedId, isActive: true } });
    if (!target) throw new NotFoundError('User not found');

    const existing = await prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    if (existing) {
      throw new ConflictError('User is already blocked');
    }

    await prisma.userBlock.create({ data: { blockerId, blockedId } });
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
  }

  async listBlockedIds(blockerId: string): Promise<string[]> {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId },
      select: { blockedId: true },
    });
    return rows.map((r) => r.blockedId);
  }

  async listBlockedUsers(blockerId: string): Promise<{
    users: Array<{ id: string; username: string; displayName: string | null }>;
    blockedUserIds: string[];
  }> {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      select: {
        blockedId: true,
        blocked: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    const users = rows.map((row) => ({
      id: row.blocked.id,
      username: row.blocked.username,
      displayName: row.blocked.displayName,
    }));

    return {
      users,
      blockedUserIds: users.map((user) => user.id),
    };
  }

  async getBlockedOwnerFilter(blockerId?: string): Promise<{ ownerId?: { notIn: string[] } }> {
    if (!blockerId) return {};
    const blockedIds = await this.listBlockedIds(blockerId);
    if (blockedIds.length === 0) return {};
    return { ownerId: { notIn: blockedIds } };
  }
}

export const userBlockService = new UserBlockService();
