import { prisma } from '../prisma/client';
import { Prisma, StickerVisibility, SharePermission } from '@prisma/client';
import { RoleService } from './role.service';
import { ForbiddenError, NotFoundError } from '../errors';

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

    return prisma.stickerPack.update({
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
        },
      },
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