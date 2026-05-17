import { prisma } from '../prisma/client';
import { Prisma, SharePermission, StickerVisibility } from '@prisma/client';
import { RoleService } from './role.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import crypto from 'crypto';

export class StickerPackShareService {
  private roleService: RoleService;

  constructor(roleService: RoleService = new RoleService()) {
    this.roleService = roleService;
  }

  private async checkOwnership(stickerPackId: string, userId: string): Promise<boolean> {
    const pack = await prisma.stickerPack.findFirst({
      where: { id: stickerPackId, deletedAt: null },
    });

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    if (pack.ownerId === userId) {
      return true;
    }

    const isAdmin = await this.roleService.isAdmin(userId);
    if (isAdmin) {
      return true;
    }

    return false;
  }

  async shareWithUser(
    stickerPackId: string,
    ownerId: string,
    sharedWithId: string,
    permission: SharePermission,
    expiresAt?: Date
  ): Promise<Prisma.StickerPackShareGetPayload<object>> {
    const hasOwnership = await this.checkOwnership(stickerPackId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to share this sticker pack');
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: sharedWithId },
    });

    if (!targetUser) {
      throw new NotFoundError('User not found');
    }

    if (!Object.values(SharePermission).includes(permission)) {
      throw new ValidationError('Invalid permission value');
    }

    return prisma.stickerPackShare.upsert({
      where: {
        stickerPackId_sharedWithId: {
          stickerPackId,
          sharedWithId,
        },
      },
      update: {
        permission,
        expiresAt: expiresAt ?? null,
        grantedBy: ownerId,
      },
      create: {
        stickerPack: { connect: { id: stickerPackId } },
        sharedWith: { connect: { id: sharedWithId } },
        permission,
        expiresAt: expiresAt ?? null,
        granter: { connect: { id: ownerId } },
      },
    });
  }

  async removeUserShare(stickerPackId: string, ownerId: string, sharedWithId: string): Promise<void> {
    const hasOwnership = await this.checkOwnership(stickerPackId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to remove this share');
    }

    const share = await prisma.stickerPackShare.findUnique({
      where: {
        stickerPackId_sharedWithId: {
          stickerPackId,
          sharedWithId,
        },
      },
    });

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    await prisma.stickerPackShare.delete({
      where: {
        stickerPackId_sharedWithId: {
          stickerPackId,
          sharedWithId,
        },
      },
    });
  }

  async createShareLink(
    stickerPackId: string,
    ownerId: string,
    permission: SharePermission,
    expiresAt?: Date,
    maxUses?: number
  ): Promise<Prisma.StickerPackShareLinkGetPayload<object>> {
    const hasOwnership = await this.checkOwnership(stickerPackId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to create share link for this sticker pack');
    }

    if (!Object.values(SharePermission).includes(permission)) {
      throw new ValidationError('Invalid permission value');
    }

    const token = crypto.randomBytes(32).toString('hex');

    return prisma.stickerPackShareLink.create({
      data: {
        stickerPack: { connect: { id: stickerPackId } },
        token,
        permission,
        expiresAt: expiresAt ?? null,
        maxUses: maxUses ?? null,
        creator: { connect: { id: ownerId } },
      },
    });
  }

  async revokeShareLink(stickerPackId: string, ownerId: string, linkId: string): Promise<void> {
    const hasOwnership = await this.checkOwnership(stickerPackId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to revoke this share link');
    }

    const link = await prisma.stickerPackShareLink.findFirst({
      where: { id: linkId, stickerPackId },
    });

    if (!link) {
      throw new NotFoundError('Share link not found');
    }

    await prisma.stickerPackShareLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });
  }

  private assertUsableLink(link: {
    isActive: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    usesCount: number;
  }): void {
    if (!link.isActive) {
      throw new ForbiddenError('Share link has been revoked');
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new ForbiddenError('Share link has expired');
    }

    if (link.maxUses !== null && link.usesCount >= link.maxUses) {
      throw new ForbiddenError('Share link has exceeded maximum uses');
    }
  }

  async getShareLinkPreview(token: string): Promise<Prisma.StickerPackShareLinkGetPayload<{
    include: {
      stickerPack: {
        include: {
          owner: { select: { id: true; username: true; displayName: true; followerCount: true } };
          stickers: { include: { sticker: true }; orderBy: { order: 'asc' } };
        }
      }
    }
  }>> {
    const link = await prisma.stickerPackShareLink.findUnique({
      where: { token },
      include: {
        stickerPack: {
          include: {
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
                order: 'asc',
              },
            },
          },
        },
      },
    });

    if (!link || link.stickerPack.deletedAt) {
      throw new NotFoundError('Share link not found');
    }

    this.assertUsableLink(link);
    return link;
  }

  async listActiveLinks(stickerPackId: string, ownerId: string): Promise<Prisma.StickerPackShareLinkGetPayload<object>[]> {
    const hasOwnership = await this.checkOwnership(stickerPackId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to list share links for this sticker pack');
    }

    return prisma.stickerPackShareLink.findMany({
      where: {
        stickerPackId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async acceptShareLink(token: string, userId: string): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }>> {
    return prisma.$transaction(async (tx) => {
      const link = await tx.stickerPackShareLink.findUnique({
        where: { token },
        include: {
          stickerPack: {
            include: {
              stickers: {
                include: {
                  sticker: true,
                },
                orderBy: {
                  order: 'asc',
                },
              },
            },
          },
        },
      });

      if (!link || link.stickerPack.deletedAt) {
        throw new NotFoundError('Share link not found');
      }

      this.assertUsableLink(link);

      const cloned = await tx.stickerPack.create({
        data: {
          owner: { connect: { id: userId } },
          name: link.stickerPack.name,
          description: link.stickerPack.description,
          visibility: StickerVisibility.PRIVATE,
          stickers: {
            create: link.stickerPack.stickers.map((item) => ({
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

      await tx.stickerPackShareLink.update({
        where: { id: link.id },
        data: { usesCount: { increment: 1 } },
      });

      return cloned;
    });
  }

  async validateShareLink(token: string): Promise<Prisma.StickerPackShareLinkGetPayload<{ include: { stickerPack: true } }>> {
    const link = await prisma.stickerPackShareLink.findUnique({
      where: { token },
      include: { stickerPack: true },
    });

    if (!link) {
      throw new NotFoundError('Share link not found');
    }

    this.assertUsableLink(link);

    await prisma.stickerPackShareLink.update({
      where: { id: link.id },
      data: { usesCount: { increment: 1 } },
    });

    return link;
  }
}
