import { prisma } from '../prisma/client';
import { RoleService } from './role.service';
import { ForbiddenError, NotFoundError } from '../errors';
import { StickerVisibility, SharePermission, Prisma } from '@prisma/client';

export type StickerAction = 'read' | 'update' | 'delete';

export interface CreateStickerInput {
  ownerId: string;
  name: string;
  filename: string;
  url: string;
  visibility?: StickerVisibility;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateStickerInput {
  name?: string;
  visibility?: StickerVisibility;
}

export class StickerService {
  private roleService: RoleService;

  constructor(roleService: RoleService = new RoleService()) {
    this.roleService = roleService;
  }

  async create(input: CreateStickerInput): Promise<Prisma.StickerGetPayload<{ include: { owner: { select: { id: true; username: true; displayName: true } } } }>> {
    const visibility = input.visibility ?? StickerVisibility.PRIVATE;

    if (!Object.values(StickerVisibility).includes(visibility)) {
      throw new ForbiddenError('Invalid visibility value');
    }

    const data: Prisma.StickerCreateInput = {
      owner: { connect: { id: input.ownerId } },
      name: input.name,
      filename: input.filename,
      url: input.url,
      visibility,
      width: input.width,
      height: input.height,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
    };

    if (input.metadata !== undefined) {
      data.metadata = input.metadata;
    }

    return prisma.sticker.create({
      data,
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });
  }

  async findById(id: string): Promise<Prisma.StickerGetPayload<{ include: { owner: { select: { id: true; username: true; displayName: true } } } }> | null> {
    return prisma.sticker.findFirst({
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
      },
    });
  }

  async findByOwner(ownerId: string): Promise<Prisma.StickerGetPayload<object>[]> {
    return prisma.sticker.findMany({
      where: {
        ownerId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findPublic(): Promise<Prisma.StickerGetPayload<{ include: { owner: { select: { id: true; username: true; displayName: true } } } }>[]> {
    return prisma.sticker.findMany({
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
      },
    });
  }

  async cloneSticker(id: string, userId: string): Promise<Prisma.StickerGetPayload<{ include: { owner: { select: { id: true; username: true; displayName: true } } } }>> {
    const sticker = await this.findById(id);

    if (!sticker || sticker.deletedAt) {
      throw new NotFoundError('Sticker not found');
    }

    return prisma.sticker.create({
      data: {
        owner: { connect: { id: userId } },
        name: sticker.name,
        filename: sticker.filename,
        url: sticker.url,
        visibility: StickerVisibility.PRIVATE,
        width: sticker.width,
        height: sticker.height,
        fileSize: sticker.fileSize,
        mimeType: sticker.mimeType,
        metadata: sticker.metadata === null ? Prisma.JsonNull : sticker.metadata as Prisma.InputJsonValue,
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });
  }

  async update(id: string, userId: string, input: UpdateStickerInput): Promise<Prisma.StickerGetPayload<{ include: { owner: { select: { id: true; username: true; displayName: true } } } }>> {
    const sticker = await this.findById(id);

    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    const hasAccess = await this.checkAccess(id, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to update this sticker');
    }

    return prisma.sticker.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
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
      },
    });
  }

  async delete(id: string, userId: string): Promise<Prisma.StickerGetPayload<object>> {
    const sticker = await this.findById(id);

    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    const hasAccess = await this.checkAccess(id, userId, 'delete');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to delete this sticker');
    }

    return prisma.sticker.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async checkAccess(stickerId: string, userId: string, action: StickerAction): Promise<boolean> {
    const sticker = await prisma.sticker.findFirst({
      where: {
        id: stickerId,
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

    if (!sticker) {
      return false;
    }

    // Owner always has access
    if (sticker.ownerId === userId) {
      return true;
    }

    // Admin always has access
    const isAdmin = await this.roleService.isAdmin(userId);
    if (isAdmin) {
      return true;
    }

    // Public stickers: read only
    if (sticker.visibility === StickerVisibility.PUBLIC) {
      return action === 'read';
    }

    // Private stickers: check shares
    if (sticker.visibility === StickerVisibility.PRIVATE) {
      const share = sticker.shares[0];
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
    if (sticker.visibility === StickerVisibility.UNLISTED) {
      return false;
    }

    return false;
  }
}
