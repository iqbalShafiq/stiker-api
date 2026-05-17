import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StickerPackShareService } from '../../../src/services/sticker-pack-share.service';
import { prisma } from '../../../src/prisma/client';
import { SharePermission } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../src/errors';

const mockedPrisma = vi.mocked(prisma);

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    stickerPack: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    stickerPackShare: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    stickerPackShareLink: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/role.service', () => ({
  RoleService: vi.fn().mockImplementation(() => ({
    isAdmin: vi.fn().mockResolvedValue(false),
  })),
}));

describe('StickerPackShareService', () => {
  const service = new StickerPackShareService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shareWithUser', () => {
    it('should share pack with another user', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
      };

      const mockUser = {
        id: 'user-2',
        email: 'user2@test.com',
      };

      const mockShare = {
        id: 'share-1',
        stickerPackId: 'pack-1',
        sharedWithId: 'user-2',
        permission: SharePermission.VIEW,
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);
      (mockedPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (mockedPrisma.stickerPackShare.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(mockShare);

      const result = await service.shareWithUser('pack-1', 'user-1', 'user-2', SharePermission.VIEW);

      expect(result).toEqual(mockShare);
    });

    it('should throw NotFoundError for non-existent pack', async () => {
      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.shareWithUser('pack-1', 'user-1', 'user-2')).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError for non-owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-2',
        deletedAt: null,
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      await expect(service.shareWithUser('pack-1', 'user-1', 'user-3')).rejects.toThrow(ForbiddenError);
    });

    it('should throw ValidationError for sharing with self', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      await expect(service.shareWithUser('pack-1', 'user-1', 'user-1')).rejects.toThrow(ValidationError);
    });
  });

  describe('removeUserShare', () => {
    it('should remove share for owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
      };

      const mockShare = {
        id: 'share-1',
        stickerPackId: 'pack-1',
        sharedWithId: 'user-2',
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);
      (mockedPrisma.stickerPackShare.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockShare);

      await service.removeUserShare('pack-1', 'user-1', 'user-2');

      expect(mockedPrisma.stickerPackShare.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundError for non-existent share', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);
      (mockedPrisma.stickerPackShare.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.removeUserShare('pack-1', 'user-1', 'user-2')).rejects.toThrow(NotFoundError);
    });
  });

  describe('createShareLink', () => {
    it('should create share link for owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
      };

      const mockLink = {
        id: 'link-1',
        stickerPackId: 'pack-1',
        token: 'abc123',
        permission: SharePermission.VIEW,
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);
      (mockedPrisma.stickerPackShareLink.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);

      const result = await service.createShareLink('pack-1', 'user-1', SharePermission.VIEW);

      expect(result).toEqual(mockLink);
      expect(mockedPrisma.stickerPackShareLink.create).toHaveBeenCalled();
    });

    it('should throw ForbiddenError for non-owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-2',
        deletedAt: null,
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      await expect(service.createShareLink('pack-1', 'user-1')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('revokeShareLink', () => {
    it('should revoke share link for owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
      };

      const mockLink = {
        id: 'link-1',
        stickerPackId: 'pack-1',
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);
      (mockedPrisma.stickerPackShareLink.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);

      await service.revokeShareLink('pack-1', 'user-1', 'link-1');

      expect(mockedPrisma.stickerPackShareLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundError for non-existent link', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);
      (mockedPrisma.stickerPackShareLink.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.revokeShareLink('pack-1', 'user-1', 'link-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('validateShareLink', () => {
    it('should preview active link without incrementing uses count', async () => {
      const mockLink = {
        id: 'link-1',
        token: 'abc123',
        isActive: true,
        expiresAt: null,
        maxUses: null,
        usesCount: 0,
        stickerPack: { id: 'pack-1', name: 'Test Pack', deletedAt: null },
      };

      (mockedPrisma.stickerPackShareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);

      const result = await service.getShareLinkPreview('abc123');

      expect(result).toEqual(mockLink);
      expect(mockedPrisma.stickerPackShareLink.update).not.toHaveBeenCalled();
    });

    it('should validate and return active link', async () => {
      const mockLink = {
        id: 'link-1',
        token: 'abc123',
        isActive: true,
        expiresAt: null,
        maxUses: null,
        usesCount: 0,
        stickerPack: { id: 'pack-1', name: 'Test Pack' },
      };

      (mockedPrisma.stickerPackShareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);
      (mockedPrisma.stickerPackShareLink.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockLink,
        usesCount: 1,
      });

      const result = await service.validateShareLink('abc123');

      expect(result).toEqual(mockLink);
      expect(mockedPrisma.stickerPackShareLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { usesCount: { increment: 1 } },
      });
    });

    it('should throw NotFoundError for invalid token', async () => {
      (mockedPrisma.stickerPackShareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.validateShareLink('invalid')).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError for revoked link', async () => {
      const mockLink = {
        id: 'link-1',
        token: 'abc123',
        isActive: false,
      };

      (mockedPrisma.stickerPackShareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);

      await expect(service.validateShareLink('abc123')).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError for expired link', async () => {
      const mockLink = {
        id: 'link-1',
        token: 'abc123',
        isActive: true,
        expiresAt: new Date('2020-01-01'),
        maxUses: null,
        usesCount: 0,
      };

      (mockedPrisma.stickerPackShareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);

      await expect(service.validateShareLink('abc123')).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError for exceeded max uses', async () => {
      const mockLink = {
        id: 'link-1',
        token: 'abc123',
        isActive: true,
        expiresAt: null,
        maxUses: 5,
        usesCount: 5,
      };

      (mockedPrisma.stickerPackShareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);

      await expect(service.validateShareLink('abc123')).rejects.toThrow(ForbiddenError);
    });
  });
});
