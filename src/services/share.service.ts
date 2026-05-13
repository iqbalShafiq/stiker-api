import { prisma } from '../prisma/client';
import { RoleService } from './role.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { SharePermission } from '@prisma/client';
import crypto from 'crypto';

export class ShareService {
  private roleService: RoleService;

  constructor(roleService: RoleService = new RoleService()) {
    this.roleService = roleService;
  }

  private async checkOwnership(stickerId: string, userId: string): Promise<boolean> {
    const sticker = await prisma.sticker.findFirst({
      where: { id: stickerId, deletedAt: null },
    });

    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    if (sticker.ownerId === userId) {
      return true;
    }

    const isAdmin = await this.roleService.isAdmin(userId);
    if (isAdmin) {
      return true;
    }

    return false;
  }

  async shareWithUser(
    stickerId: string,
    ownerId: string,
    sharedWithId: string,
    permission: SharePermission,
    expiresAt?: Date
  ): Promise<ReturnType<typeof prisma.stickerShare.upsert>> {
    const hasOwnership = await this.checkOwnership(stickerId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to share this sticker');
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

    return prisma.stickerShare.upsert({
      where: {
        stickerId_sharedWithId: {
          stickerId,
          sharedWithId,
        },
      },
      update: {
        permission,
        expiresAt: expiresAt ?? null,
        grantedBy: ownerId,
      },
      create: {
        sticker: { connect: { id: stickerId } },
        sharedWith: { connect: { id: sharedWithId } },
        permission,
        expiresAt: expiresAt ?? null,
        granter: { connect: { id: ownerId } },
      },
    });
  }

  async removeUserShare(stickerId: string, ownerId: string, sharedWithId: string): Promise<ReturnType<typeof prisma.stickerShare.delete>> {
    const hasOwnership = await this.checkOwnership(stickerId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to remove this share');
    }

    const share = await prisma.stickerShare.findUnique({
      where: {
        stickerId_sharedWithId: {
          stickerId,
          sharedWithId,
        },
      },
    });

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    return prisma.stickerShare.delete({
      where: {
        stickerId_sharedWithId: {
          stickerId,
          sharedWithId,
        },
      },
    });
  }

  async createShareLink(
    stickerId: string,
    ownerId: string,
    permission: SharePermission,
    expiresAt?: Date,
    maxUses?: number
  ): Promise<ReturnType<typeof prisma.stickerShareLink.create>> {
    const hasOwnership = await this.checkOwnership(stickerId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to create share link for this sticker');
    }

    if (!Object.values(SharePermission).includes(permission)) {
      throw new ValidationError('Invalid permission value');
    }

    const token = crypto.randomBytes(32).toString('hex');

    return prisma.stickerShareLink.create({
      data: {
        sticker: { connect: { id: stickerId } },
        token,
        permission,
        expiresAt: expiresAt ?? null,
        maxUses: maxUses ?? null,
        creator: { connect: { id: ownerId } },
      },
    });
  }

  async revokeShareLink(stickerId: string, ownerId: string, linkId: string): Promise<ReturnType<typeof prisma.stickerShareLink.update>> {
    const hasOwnership = await this.checkOwnership(stickerId, ownerId);
    if (!hasOwnership) {
      throw new ForbiddenError('You do not have permission to revoke this share link');
    }

    const link = await prisma.stickerShareLink.findFirst({
      where: { id: linkId, stickerId },
    });

    if (!link) {
      throw new NotFoundError('Share link not found');
    }

    return prisma.stickerShareLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });
  }

  async validateShareLink(token: string): Promise<ReturnType<typeof prisma.stickerShareLink.findUnique>> {
    const link = await prisma.stickerShareLink.findUnique({
      where: { token },
      include: { sticker: true },
    });

    if (!link) {
      throw new NotFoundError('Share link not found');
    }

    if (!link.isActive) {
      throw new ForbiddenError('Share link has been revoked');
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new ForbiddenError('Share link has expired');
    }

    if (link.maxUses !== null && link.usesCount >= link.maxUses) {
      throw new ForbiddenError('Share link has exceeded maximum uses');
    }

    await prisma.stickerShareLink.update({
      where: { id: link.id },
      data: { usesCount: { increment: 1 } },
    });

    return link;
  }
}
