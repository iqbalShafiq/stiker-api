import { prisma } from '../prisma/client';
import { Prisma, StickerVisibility, SharePermission } from '@prisma/client';
import { RoleService } from './role.service';
import { ForbiddenError, NotFoundError } from '../errors';
import {
  buildPublicBaseWhere,
  buildSearchFilter,
  getPublicOrderBy,
  loadViewerSocialState,
  mapPackWithSocial,
  normalizePublicQuery,
  PUBLIC_PACK_INCLUDE,
  type PublicStickerPackQuery,
  type PublicStickerPackSort,
} from '../utils/pack-query';
import { aiUsageService } from './ai-usage.service';
import { notificationService } from './notification.service';

export interface CreateStickerPackInput {
  ownerId: string;
  name: string;
  description?: string;
  visibility?: StickerVisibility;
  stickers?: Array<{
    name: string;
    filename: string;
    url: string;
    width?: number;
    height?: number;
    fileSize?: number;
    mimeType?: string;
    order?: number;
  }>;
}

export interface UpdateStickerPackInput {
  name?: string;
  description?: string;
  visibility?: StickerVisibility;
}

export interface AddStickerToPackInput {
  stickerPackId: string;
  name: string;
  filename: string;
  url: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  order?: number;
}

export type StickerPackAction = 'read' | 'update' | 'delete';
export type { PublicStickerPackQuery, PublicStickerPackSort };

export class StickerPackService {
  private roleService: RoleService;

  constructor(roleService: RoleService = new RoleService()) {
    this.roleService = roleService;
  }

  async create(input: CreateStickerPackInput): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }>> {
    const visibility = input.visibility ?? StickerVisibility.PRIVATE;

    if (!Object.values(StickerVisibility).includes(visibility)) {
      throw new ForbiddenError('Invalid visibility value');
    }

    return prisma.stickerPack.create({
      data: {
        owner: { connect: { id: input.ownerId } },
        name: input.name,
        description: input.description,
        visibility,
        ...(input.stickers && input.stickers.length > 0 && {
          stickers: {
            create: input.stickers.map((s, index) => ({
              order: s.order ?? index,
              sticker: {
                create: {
                  owner: { connect: { id: input.ownerId } },
                  name: s.name,
                  filename: s.filename,
                  url: s.url,
                  width: s.width,
                  height: s.height,
                  fileSize: s.fileSize,
                  mimeType: s.mimeType,
                  visibility,
                },
              },
            })),
          },
        }),
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
        },
      },
    });
  }

  async findById(id: string): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }> | null> {
    return prisma.stickerPack.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
          orderBy: {
            order: 'asc',
          },
        },
      },
    });
  }

  async findByOwner(ownerId: string): Promise<Prisma.StickerPackGetPayload<object>[]> {
    return prisma.stickerPack.findMany({
      where: {
        ownerId,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  private async paginatePublicPacks(
    where: Prisma.StickerPackWhereInput,
    query: PublicStickerPackQuery,
    viewerId?: string
  ) {
    const { page, limit, sort } = normalizePublicQuery(query);
    const fullWhere = {
      ...buildPublicBaseWhere(),
      ...where,
      ...buildSearchFilter(query.q),
    };

    const [total, data] = await prisma.$transaction([
      prisma.stickerPack.count({ where: fullWhere }),
      prisma.stickerPack.findMany({
        where: fullWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: getPublicOrderBy(sort),
        include: PUBLIC_PACK_INCLUDE,
      }),
    ]);

    const enriched = await Promise.all(
      data.map(async (pack) => {
        const social = await loadViewerSocialState(pack, viewerId);
        return mapPackWithSocial(pack, social);
      })
    );

    return {
      data: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findPublicPaginated(query: PublicStickerPackQuery = {}, viewerId?: string) {
    const ownerFilter = query.ownerId ? { ownerId: query.ownerId } : {};
    return this.paginatePublicPacks(ownerFilter, query, viewerId);
  }

  async findSavedPaginated(userId: string, query: PublicStickerPackQuery = {}) {
    const savedPackIds = await prisma.stickerPackSave.findMany({
      where: { userId },
      select: { stickerPackId: true },
    });
    const ids = savedPackIds.map((s) => s.stickerPackId);
    if (ids.length === 0) {
      const { page, limit } = normalizePublicQuery(query);
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }
    return this.paginatePublicPacks({ id: { in: ids } }, query, userId);
  }

  async findFollowingPaginated(userId: string, query: PublicStickerPackQuery = {}) {
    const following = await prisma.userFollow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const ownerIds = following.map((f) => f.followingId);
    if (ownerIds.length === 0) {
      const { page, limit } = normalizePublicQuery(query);
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }
    return this.paginatePublicPacks({ ownerId: { in: ownerIds } }, query, userId);
  }

  async findSharedWithMePaginated(userId: string, query: PublicStickerPackQuery = {}) {
    const shares = await prisma.stickerPackShare.findMany({
      where: {
        sharedWithId: userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { stickerPackId: true },
    });
    const ids = shares.map((s) => s.stickerPackId);
    if (ids.length === 0) {
      const { page, limit } = normalizePublicQuery(query);
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }
    return this.paginatePublicPacks({ id: { in: ids } }, query, userId);
  }

  async findPublic(): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }>[]> {
    return prisma.stickerPack.findMany({
      where: {
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
        },
      },
    });
  }

  async findPublicById(id: string, viewerId?: string) {
    const pack = await prisma.stickerPack.findFirst({
      where: {
        id,
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
      },
      include: PUBLIC_PACK_INCLUDE,
    });

    if (!pack) {
      return null;
    }

    const social = await loadViewerSocialState(pack, viewerId);
    return mapPackWithSocial(pack, social);
  }

  async importPublicPack(id: string, userId: string): Promise<{
    pack: Prisma.StickerPackGetPayload<{
      include: {
        owner: { select: { id: true; username: true; displayName: true } };
        stickers: { include: { sticker: true } };
      };
    }>;
    pointCost: number;
    ownerCredited: number;
    pointsRemaining: number;
  }> {
    const source = await prisma.stickerPack.findFirst({
      where: {
        id,
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
      },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true },
        },
        stickers: {
          include: { sticker: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!source) {
      throw new NotFoundError('Public sticker pack not found');
    }

    const transfer = await aiUsageService.transferPointsForPackImport(userId, source.ownerId);

    const pack = await prisma.$transaction(async (tx) => {
      return tx.stickerPack.create({
        data: {
          owner: { connect: { id: userId } },
          name: source.name,
          description: source.description,
          visibility: StickerVisibility.PRIVATE,
          stickers: {
            create: source.stickers.map((item) => ({
              order: item.order,
              sticker: {
                create: {
                  owner: { connect: { id: userId } },
                  name: item.sticker.name,
                  filename: item.sticker.filename,
                  url: item.sticker.url,
                  width: item.sticker.width,
                  height: item.sticker.height,
                  fileSize: item.sticker.fileSize,
                  mimeType: item.sticker.mimeType,
                  metadata: item.sticker.metadata === null ? Prisma.JsonNull : item.sticker.metadata as Prisma.InputJsonValue,
                  visibility: StickerVisibility.PRIVATE,
                },
              },
            })),
          },
        },
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          stickers: {
            include: {
              sticker: true,
            },
            orderBy: {
              order: 'asc',
            },
          },
        },
      });
    });

    if (source.ownerId !== userId) {
      void notificationService.create({
        userId: source.ownerId,
        type: 'PACK_IMPORT',
        title: 'Someone imported your pack',
        body: `Your pack "${source.name}" was imported`,
        payload: { packId: source.id, importerId: userId, pointCost: transfer.pointCost },
      });
    }

    return {
      pack,
      pointCost: transfer.pointCost,
      ownerCredited: transfer.ownerCredited,
      pointsRemaining: transfer.usage.pointsRemaining,
    };
  }

  async update(id: string, userId: string, input: UpdateStickerPackInput): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }>> {
    const pack = await this.findById(id);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(id, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to update this sticker pack');
    }

    if (input.visibility !== undefined && !Object.values(StickerVisibility).includes(input.visibility)) {
      throw new ForbiddenError('Invalid visibility value');
    }

    return prisma.$transaction(async (tx) => {
      const updatedPack = await tx.stickerPack.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.visibility !== undefined && { visibility: input.visibility }),
        },
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          stickers: {
            include: {
              sticker: true,
            },
            orderBy: {
              order: 'asc',
            },
          },
        },
      });

      if (input.visibility !== undefined) {
        await tx.sticker.updateMany({
          where: {
            deletedAt: null,
            stickerPacks: {
              some: { stickerPackId: id },
            },
          },
          data: { visibility: input.visibility },
        });
      }

      return updatedPack;
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const pack = await this.findById(id);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(id, userId, 'delete');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to delete this sticker pack');
    }

    await prisma.stickerPack.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async addSticker(input: AddStickerToPackInput): Promise<Prisma.StickerPackStickerGetPayload<{
    include: { sticker: true }
  }>> {
    const pack = await this.findById(input.stickerPackId);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const maxOrder = await prisma.stickerPackSticker.aggregate({
      where: { stickerPackId: input.stickerPackId },
      _max: { order: true },
    });

    const nextOrder = (maxOrder._max.order ?? -1) + 1;

    return prisma.stickerPackSticker.create({
      data: {
        stickerPack: { connect: { id: input.stickerPackId } },
        sticker: {
          create: {
            owner: { connect: { id: pack.ownerId } },
            name: input.name,
            filename: input.filename,
            url: input.url,
            width: input.width,
            height: input.height,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            visibility: pack.visibility,
          },
        },
        order: input.order ?? nextOrder,
      },
      include: {
        sticker: true,
      },
    });
  }

  async clearPackStickers(stickerPackId: string, userId: string): Promise<void> {
    const pack = await this.findById(stickerPackId);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(stickerPackId, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to modify this sticker pack');
    }

    await prisma.stickerPackSticker.deleteMany({
      where: { stickerPackId },
    });
  }

  async removeSticker(stickerPackId: string, stickerId: string, userId: string): Promise<void> {
    const pack = await this.findById(stickerPackId);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(stickerPackId, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to modify this sticker pack');
    }

    await prisma.stickerPackSticker.deleteMany({
      where: {
        stickerPackId,
        stickerId,
      },
    });
  }

  async reorderStickers(stickerPackId: string, userId: string, stickerOrders: Array<{ stickerId: string; order: number }>): Promise<void> {
    const pack = await this.findById(stickerPackId);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(stickerPackId, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to modify this sticker pack');
    }

    await prisma.$transaction(
      stickerOrders.map(({ stickerId, order }) =>
        prisma.stickerPackSticker.updateMany({
          where: {
            stickerPackId,
            stickerId,
          },
          data: { order },
        })
      )
    );
  }

  async checkAccess(stickerPackId: string, userId: string, action: StickerPackAction): Promise<boolean> {
    const pack = await prisma.stickerPack.findFirst({
      where: {
        id: stickerPackId,
        deletedAt: null,
      },
      include: {
        owner: true,
        shares: {
          where: {
            sharedWithId: userId,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        },
      },
    });

    if (!pack) {
      return false;
    }

    // Owner always has access
    if (pack.ownerId === userId) {
      return true;
    }

    // Admin always has access
    const isAdmin = await this.roleService.isAdmin(userId);
    if (isAdmin) {
      return true;
    }

    // Public packs: read only
    if (pack.visibility === StickerVisibility.PUBLIC) {
      return action === 'read';
    }

    // Private packs: check shares
    if (pack.visibility === StickerVisibility.PRIVATE) {
      const share = pack.shares[0];
      if (!share) {
        return false;
      }

      if (share.permission === SharePermission.EDIT) {
        return true;
      }

      if (share.permission === SharePermission.VIEW) {
        return action === 'read';
      }

      return false;
    }

    // Unlisted (link-only): checked separately via share token
    if (pack.visibility === StickerVisibility.UNLISTED) {
      return false;
    }

    return false;
  }
}
