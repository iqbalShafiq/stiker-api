import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StickerPackService } from '../../../src/services/sticker-pack.service';
import { prisma } from '../../../src/prisma/client';
import { StickerVisibility, SharePermission } from '@prisma/client';
import { RoleService } from '../../../src/services/role.service';
import { ForbiddenError, NotFoundError } from '../../../src/errors';

const mockedPrisma = vi.mocked(prisma);
const mockedRoleService = vi.mocked(RoleService);

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    stickerPack: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    stickerPackSticker: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/role.service', () => ({
  RoleService: vi.fn().mockImplementation(() => ({
    isAdmin: vi.fn().mockResolvedValue(false),
  })),
}));

describe('StickerPackService', () => {
  const service = new StickerPackService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create sticker pack with default visibility', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        name: 'Test Pack',
        description: null,
        visibility: StickerVisibility.PRIVATE,
        stickers: [],
        owner: { id: 'user-1', username: 'test', displayName: null },
      };

      (mockedPrisma.stickerPack.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.create({
        ownerId: 'user-1',
        name: 'Test Pack',
      });

      expect(result).toEqual(mockPack);
      expect(mockedPrisma.stickerPack.create).toHaveBeenCalledWith({
        data: {
          owner: { connect: { id: 'user-1' } },
          name: 'Test Pack',
          description: undefined,
          visibility: StickerVisibility.PRIVATE,
        },
        include: expect.any(Object),
      });
    });

    it('should create sticker pack with stickers', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        name: 'Test Pack',
        visibility: StickerVisibility.PRIVATE,
        stickers: [],
        owner: { id: 'user-1', username: 'test', displayName: null },
      };

      (mockedPrisma.stickerPack.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      await service.create({
        ownerId: 'user-1',
        name: 'Test Pack',
        stickers: [{
          name: 'Sticker 1',
          filename: 'sticker1.png',
          url: 'http://localhost:3000/uploads/sticker1.png',
        }],
      });

      expect(mockedPrisma.stickerPack.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stickers: expect.objectContaining({
              create: expect.any(Array),
            }),
          }),
        })
      );
    });

    it('should throw ForbiddenError for invalid visibility', async () => {
      await expect(service.create({
        ownerId: 'user-1',
        name: 'Test Pack',
        visibility: 'INVALID' as StickerVisibility,
      })).rejects.toThrow(ForbiddenError);
    });
  });

  describe('findById', () => {
    it('should find pack by id', async () => {
      const mockPack = {
        id: 'pack-1',
        name: 'Test Pack',
        deletedAt: null,
        stickers: [],
        owner: { id: 'user-1', username: 'test', displayName: null },
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.findById('pack-1');

      expect(result).toEqual(mockPack);
      expect(mockedPrisma.stickerPack.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'pack-1',
          deletedAt: null,
        },
        include: expect.any(Object),
      });
    });

    it('should return null for deleted pack', async () => {
      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.findById('pack-1');

      expect(result).toBeNull();
    });
  });

  describe('findByOwner', () => {
    it('should find packs by owner', async () => {
      const mockPacks = [
        { id: 'pack-1', ownerId: 'user-1', name: 'Pack 1' },
        { id: 'pack-2', ownerId: 'user-1', name: 'Pack 2' },
      ];

      (mockedPrisma.stickerPack.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockPacks);

      const result = await service.findByOwner('user-1');

      expect(result).toEqual(mockPacks);
      expect(mockedPrisma.stickerPack.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: 'user-1',
          deletedAt: null,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });
    });
  });

  describe('update', () => {
    it('should update pack for owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        name: 'Old Name',
        deletedAt: null,
        stickers: [],
        owner: { id: 'user-1', username: 'test', displayName: null },
        shares: [],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);
      (mockedPrisma.stickerPack.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockPack,
        name: 'New Name',
      });

      const result = await service.update('pack-1', 'user-1', { name: 'New Name' });

      expect(result.name).toBe('New Name');
    });

    it('should throw NotFoundError for non-existent pack', async () => {
      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.update('pack-1', 'user-1', { name: 'New' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should soft delete pack for owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
        stickers: [],
        owner: { id: 'user-1', username: 'test', displayName: null },
        shares: [],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      await service.delete('pack-1', 'user-1');

      expect(mockedPrisma.stickerPack.update).toHaveBeenCalledWith({
        where: { id: 'pack-1' },
        data: {
          deletedAt: expect.any(Date),
        },
      });
    });
  });

  describe('checkAccess', () => {
    it('should return true for owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-1',
        deletedAt: null,
        owner: { id: 'user-1' },
        shares: [],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.checkAccess('pack-1', 'user-1', 'read');

      expect(result).toBe(true);
    });

    it('should allow public read for anyone', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-2',
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
        owner: { id: 'user-2' },
        shares: [],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.checkAccess('pack-1', 'user-1', 'read');

      expect(result).toBe(true);
    });

    it('should deny public write for non-owner', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-2',
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
        owner: { id: 'user-2' },
        shares: [],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.checkAccess('pack-1', 'user-1', 'update');

      expect(result).toBe(false);
    });

    it('should allow VIEW share permission for read', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-2',
        visibility: StickerVisibility.PRIVATE,
        deletedAt: null,
        owner: { id: 'user-2' },
        shares: [{
          sharedWithId: 'user-1',
          permission: SharePermission.VIEW,
          expiresAt: null,
        }],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.checkAccess('pack-1', 'user-1', 'read');

      expect(result).toBe(true);
    });

    it('should deny VIEW share permission for update', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-2',
        visibility: StickerVisibility.PRIVATE,
        deletedAt: null,
        owner: { id: 'user-2' },
        shares: [{
          sharedWithId: 'user-1',
          permission: SharePermission.VIEW,
          expiresAt: null,
        }],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.checkAccess('pack-1', 'user-1', 'update');

      expect(result).toBe(false);
    });

    it('should allow EDIT share permission for any action', async () => {
      const mockPack = {
        id: 'pack-1',
        ownerId: 'user-2',
        visibility: StickerVisibility.PRIVATE,
        deletedAt: null,
        owner: { id: 'user-2' },
        shares: [{
          sharedWithId: 'user-1',
          permission: SharePermission.EDIT,
          expiresAt: null,
        }],
      };

      (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockPack);

      const result = await service.checkAccess('pack-1', 'user-1', 'delete');

      expect(result).toBe(true);
    });
  });
});