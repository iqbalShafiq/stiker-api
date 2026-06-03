import { Prisma, StickerVisibility } from '@prisma/client';
import { ValidationError } from '../errors';

export type PublicStickerPackSort = 'recent' | 'popular' | 'downloads' | 'likes' | 'saves';

export interface PublicStickerPackQuery {
  page?: number;
  limit?: number;
  sort?: PublicStickerPackSort;
  q?: string;
  ownerId?: string;
}

export const PUBLIC_PACK_INCLUDE = {
  owner: {
    select: {
      id: true,
      username: true,
      displayName: true,
      followerCount: true,
    },
  },
  stickers: {
    include: {
      sticker: true,
    },
    orderBy: {
      order: 'asc' as const,
    },
  },
} satisfies Prisma.StickerPackInclude;

export function normalizePublicQuery(query: PublicStickerPackQuery): Required<Pick<PublicStickerPackQuery, 'page' | 'limit' | 'sort'>> & {
  q?: string;
  ownerId?: string;
} {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Math.floor(query.limit ?? 20)));
  const sort = query.sort ?? 'recent';

  if (!['recent', 'popular', 'downloads', 'likes', 'saves'].includes(sort)) {
    throw new ValidationError('Invalid sort value');
  }

  const q = typeof query.q === 'string' && query.q.trim().length > 0 ? query.q.trim() : undefined;
  const ownerId = typeof query.ownerId === 'string' && query.ownerId.trim().length > 0 ? query.ownerId.trim() : undefined;

  return { page, limit, sort, q, ownerId };
}

export function buildPublicBaseWhere(
  extra?: Prisma.StickerPackWhereInput
): Prisma.StickerPackWhereInput {
  return {
    visibility: StickerVisibility.PUBLIC,
    deletedAt: null,
    ...extra,
  };
}

export function buildSearchFilter(q?: string): Prisma.StickerPackWhereInput {
  if (!q) {
    return {};
  }
  return {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { owner: { username: { contains: q, mode: 'insensitive' } } },
      { owner: { displayName: { contains: q, mode: 'insensitive' } } },
    ],
  };
}

export function getPublicOrderBy(sort: PublicStickerPackSort): Prisma.StickerPackOrderByWithRelationInput[] {
  if (sort === 'popular') {
    return [{ likeCount: 'desc' }, { downloadCount: 'desc' }, { createdAt: 'desc' }];
  }
  if (sort === 'downloads') {
    return [{ downloadCount: 'desc' }, { createdAt: 'desc' }];
  }
  if (sort === 'likes') {
    return [{ likeCount: 'desc' }, { createdAt: 'desc' }];
  }
  if (sort === 'saves') {
    return [{ saveCount: 'desc' }, { createdAt: 'desc' }];
  }
  return [{ createdAt: 'desc' }];
}

export type PackWithPublicInclude = Prisma.StickerPackGetPayload<{ include: typeof PUBLIC_PACK_INCLUDE }>;

export interface PackViewerSocialState {
  isLiked: boolean;
  isSaved: boolean;
  isFollowingOwner: boolean;
}

export async function loadViewerSocialState(
  pack: PackWithPublicInclude,
  viewerId?: string
): Promise<PackViewerSocialState> {
  if (!viewerId) {
    return { isLiked: false, isSaved: false, isFollowingOwner: false };
  }

  const { prisma } = await import('../prisma/client');
  const [like, save, follow] = await Promise.all([
    prisma.stickerPackLike.findUnique({
      where: {
        stickerPackId_userId: {
          stickerPackId: pack.id,
          userId: viewerId,
        },
      },
    }),
    prisma.stickerPackSave.findUnique({
      where: {
        stickerPackId_userId: {
          stickerPackId: pack.id,
          userId: viewerId,
        },
      },
    }),
    pack.ownerId === viewerId
      ? Promise.resolve(null)
      : prisma.userFollow.findUnique({
          where: {
            followerId_followingId: {
              followerId: viewerId,
              followingId: pack.ownerId,
            },
          },
        }),
  ]);

  return {
    isLiked: like != null,
    isSaved: save != null,
    isFollowingOwner: follow != null,
  };
}

export function mapPackWithSocial<T extends PackWithPublicInclude>(
  pack: T,
  social: PackViewerSocialState
): T & PackViewerSocialState {
  return {
    ...pack,
    ...social,
  };
}
