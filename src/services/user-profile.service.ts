import { prisma } from '../prisma/client';
import { NotFoundError } from '../errors';
import {
  buildPublicBaseWhere,
  buildSearchFilter,
  getPublicOrderBy,
  normalizePublicQuery,
  PUBLIC_PACK_INCLUDE,
  type PackWithPublicInclude,
  type PublicStickerPackQuery,
} from '../utils/pack-query';

export class UserProfileService {
  async getPublicProfile(
    targetUserId: string,
    viewerId?: string
  ): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    followerCount: number;
    followingCount: number;
    createdAt: Date;
    publicPackCount: number;
    isFollowing: boolean;
  }> {
    const user = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        followerCount: true,
        followingCount: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    let isFollowing = false;
    if (viewerId && viewerId !== targetUserId) {
      const follow = await prisma.userFollow.findUnique({
        where: {
          followerId_followingId: {
            followerId: viewerId,
            followingId: targetUserId,
          },
        },
      });
      isFollowing = follow != null;
    }

    const publicPackCount = await prisma.stickerPack.count({
      where: buildPublicBaseWhere({ ownerId: targetUserId }),
    });

    return {
      ...user,
      publicPackCount,
      isFollowing,
    };
  }

  async searchUsers(
    query: string,
    limit = 10
  ): Promise<
    Array<{
      id: string;
      username: string;
      displayName: string | null;
      followerCount: number;
    }>
  > {
    const needle = query.trim();
    if (needle.length < 2) {
      return [];
    }

    return prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { username: { contains: needle, mode: 'insensitive' } },
          { displayName: { contains: needle, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        followerCount: true,
      },
      take: Math.min(20, Math.max(1, limit)),
      orderBy: { username: 'asc' },
    });
  }

  async getPublicPacksByOwner(
    ownerId: string,
    query: PublicStickerPackQuery = {}
  ): Promise<{
    data: PackWithPublicInclude[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page, limit, sort, q } = normalizePublicQuery(query);
    const where = {
      ...buildPublicBaseWhere({ ownerId }),
      ...buildSearchFilter(q),
    };

    const [total, data] = await prisma.$transaction([
      prisma.stickerPack.count({ where }),
      prisma.stickerPack.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: getPublicOrderBy(sort),
        include: PUBLIC_PACK_INCLUDE,
      }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
