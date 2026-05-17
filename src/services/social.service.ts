import { Prisma, StickerVisibility } from '@prisma/client';
import { prisma } from '../prisma/client';
import { NotFoundError, ValidationError } from '../errors';

export class SocialService {
  private async ensurePublicPack(stickerPackId: string): Promise<void> {
    const pack = await prisma.stickerPack.findFirst({
      where: {
        id: stickerPackId,
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!pack) {
      throw new NotFoundError('Public sticker pack not found');
    }
  }

  async likePack(stickerPackId: string, userId: string): Promise<{ liked: true; likeCount: number }> {
    await this.ensurePublicPack(stickerPackId);

    const pack = await prisma.$transaction(async (tx) => {
      const existing = await tx.stickerPackLike.findUnique({
        where: { stickerPackId_userId: { stickerPackId, userId } },
      });

      if (existing) {
        return tx.stickerPack.findUniqueOrThrow({
          where: { id: stickerPackId },
          select: { likeCount: true },
        });
      }

      try {
        await tx.stickerPackLike.create({ data: { stickerPackId, userId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return tx.stickerPack.findUniqueOrThrow({
            where: { id: stickerPackId },
            select: { likeCount: true },
          });
        }

        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }

      return tx.stickerPack.update({
        where: { id: stickerPackId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
    });

    return { liked: true, likeCount: pack.likeCount };
  }

  async unlikePack(stickerPackId: string, userId: string): Promise<{ liked: false; likeCount: number }> {
    await this.ensurePublicPack(stickerPackId);

    const pack = await prisma.$transaction(async (tx) => {
      const result = await tx.stickerPackLike.deleteMany({
        where: { stickerPackId, userId },
      });

      if (result.count === 0) {
        return tx.stickerPack.findUniqueOrThrow({
          where: { id: stickerPackId },
          select: { likeCount: true },
        });
      }

      return tx.stickerPack.update({
        where: { id: stickerPackId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      });
    });

    return { liked: false, likeCount: pack.likeCount };
  }

  async savePack(stickerPackId: string, userId: string): Promise<{ saved: true; saveCount: number }> {
    await this.ensurePublicPack(stickerPackId);

    const pack = await prisma.$transaction(async (tx) => {
      const existing = await tx.stickerPackSave.findUnique({
        where: { stickerPackId_userId: { stickerPackId, userId } },
      });

      if (existing) {
        return tx.stickerPack.findUniqueOrThrow({
          where: { id: stickerPackId },
          select: { saveCount: true },
        });
      }

      try {
        await tx.stickerPackSave.create({ data: { stickerPackId, userId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return tx.stickerPack.findUniqueOrThrow({
            where: { id: stickerPackId },
            select: { saveCount: true },
          });
        }

        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }

      return tx.stickerPack.update({
        where: { id: stickerPackId },
        data: { saveCount: { increment: 1 } },
        select: { saveCount: true },
      });
    });

    return { saved: true, saveCount: pack.saveCount };
  }

  async unsavePack(stickerPackId: string, userId: string): Promise<{ saved: false; saveCount: number }> {
    await this.ensurePublicPack(stickerPackId);

    const pack = await prisma.$transaction(async (tx) => {
      const result = await tx.stickerPackSave.deleteMany({
        where: { stickerPackId, userId },
      });

      if (result.count === 0) {
        return tx.stickerPack.findUniqueOrThrow({
          where: { id: stickerPackId },
          select: { saveCount: true },
        });
      }

      return tx.stickerPack.update({
        where: { id: stickerPackId },
        data: { saveCount: { decrement: 1 } },
        select: { saveCount: true },
      });
    });

    return { saved: false, saveCount: pack.saveCount };
  }

  async recordPackDownload(stickerPackId: string, userId: string): Promise<{ downloaded: true; downloadCount: number }> {
    await this.ensurePublicPack(stickerPackId);

    const pack = await prisma.$transaction(async (tx) => {
      await tx.stickerPackDownload.create({ data: { stickerPackId, userId } });
      return tx.stickerPack.update({
        where: { id: stickerPackId },
        data: { downloadCount: { increment: 1 } },
        select: { downloadCount: true },
      });
    });

    return { downloaded: true, downloadCount: pack.downloadCount };
  }

  async followUser(followingId: string, followerId: string): Promise<{ following: true; followerCount: number; followingCount: number }> {
    if (followingId === followerId) {
      throw new ValidationError('Cannot follow yourself');
    }

    const target = await prisma.user.findFirst({
      where: { id: followingId, isActive: true },
      select: { id: true },
    });

    if (!target) {
      throw new NotFoundError('User not found');
    }

    const counts = await prisma.$transaction(async (tx) => {
      const existing = await tx.userFollow.findUnique({
        where: { followerId_followingId: { followerId, followingId } },
      });

      if (existing) {
        const [targetUser, followerUser] = await Promise.all([
          tx.user.findUniqueOrThrow({ where: { id: followingId }, select: { followerCount: true } }),
          tx.user.findUniqueOrThrow({ where: { id: followerId }, select: { followingCount: true } }),
        ]);
        return { followerCount: targetUser.followerCount, followingCount: followerUser.followingCount };
      }

      try {
        await tx.userFollow.create({ data: { followerId, followingId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const [targetUser, followerUser] = await Promise.all([
            tx.user.findUniqueOrThrow({ where: { id: followingId }, select: { followerCount: true } }),
            tx.user.findUniqueOrThrow({ where: { id: followerId }, select: { followingCount: true } }),
          ]);
          return { followerCount: targetUser.followerCount, followingCount: followerUser.followingCount };
        }

        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }

      const [targetUser, followerUser] = await Promise.all([
        tx.user.update({
          where: { id: followingId },
          data: { followerCount: { increment: 1 } },
          select: { followerCount: true },
        }),
        tx.user.update({
          where: { id: followerId },
          data: { followingCount: { increment: 1 } },
          select: { followingCount: true },
        }),
      ]);

      return { followerCount: targetUser.followerCount, followingCount: followerUser.followingCount };
    });

    return { following: true, ...counts };
  }

  async unfollowUser(followingId: string, followerId: string): Promise<{ following: false; followerCount: number; followingCount: number }> {
    if (followingId === followerId) {
      throw new ValidationError('Cannot unfollow yourself');
    }

    const target = await prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true },
    });

    if (!target) {
      throw new NotFoundError('User not found');
    }

    const counts = await prisma.$transaction(async (tx) => {
      const result = await tx.userFollow.deleteMany({
        where: { followerId, followingId },
      });

      if (result.count === 0) {
        const [targetUser, followerUser] = await Promise.all([
          tx.user.findUniqueOrThrow({ where: { id: followingId }, select: { followerCount: true } }),
          tx.user.findUniqueOrThrow({ where: { id: followerId }, select: { followingCount: true } }),
        ]);
        return { followerCount: targetUser.followerCount, followingCount: followerUser.followingCount };
      }

      const [targetUser, followerUser] = await Promise.all([
        tx.user.update({
          where: { id: followingId },
          data: { followerCount: { decrement: 1 } },
          select: { followerCount: true },
        }),
        tx.user.update({
          where: { id: followerId },
          data: { followingCount: { decrement: 1 } },
          select: { followingCount: true },
        }),
      ]);

      return { followerCount: targetUser.followerCount, followingCount: followerUser.followingCount };
    });

    return { following: false, ...counts };
  }
}
