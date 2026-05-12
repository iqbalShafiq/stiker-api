import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService } from '../../../src/services/sync.service';
import { prisma } from '../../../src/prisma/client';

const mockedPrisma = vi.mocked(prisma);

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    stickerPack: {
      findMany: vi.fn(),
    },
    sticker: {
      findMany: vi.fn(),
    },
  },
}));

describe('SyncService', () => {
  const service = new SyncService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sync', () => {
    it('should return all data for first sync', async () => {
      const now = new Date();
      const mockPacks = [
        {
          id: 'pack-1',
          ownerId: 'user-1',
          name: 'Pack 1',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          owner: { id: 'user-1', username: 'test', displayName: null },
          stickers: [],
          shares: [],
        },
      ];

      const mockStickers = [
        {
          id: 'sticker-1',
          ownerId: 'user-1',
          name: 'Sticker 1',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          owner: { id: 'user-1', username: 'test', displayName: null },
        },
      ];

      (mockedPrisma.stickerPack.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockPacks);
      (mockedPrisma.sticker.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockStickers);

      const result = await service.sync({ userId: 'user-1' });

      expect(result.stickerPacks.created).toHaveLength(1);
      expect(result.stickerPacks.updated).toHaveLength(0);
      expect(result.stickerPacks.deleted).toHaveLength(0);
      expect(result.stickers.created).toHaveLength(1);
      expect(result.stickers.updated).toHaveLength(0);
      expect(result.stickers.deleted).toHaveLength(0);
      expect(result.syncToken).toBeDefined();
    });

    it('should categorize changes correctly', async () => {
      const oldDate = new Date('2024-01-01');
      const recentDate = new Date('2024-06-01');
      const lastSyncAt = new Date('2024-03-01');

      const mockPacks = [
        {
          id: 'pack-new',
          ownerId: 'user-1',
          name: 'New Pack',
          createdAt: recentDate,
          updatedAt: recentDate,
          deletedAt: null,
          owner: { id: 'user-1', username: 'test', displayName: null },
          stickers: [],
          shares: [],
        },
        {
          id: 'pack-updated',
          ownerId: 'user-1',
          name: 'Updated Pack',
          createdAt: oldDate,
          updatedAt: recentDate,
          deletedAt: null,
          owner: { id: 'user-1', username: 'test', displayName: null },
          stickers: [],
          shares: [],
        },
        {
          id: 'pack-deleted',
          ownerId: 'user-1',
          name: 'Deleted Pack',
          createdAt: oldDate,
          updatedAt: recentDate,
          deletedAt: recentDate,
          owner: { id: 'user-1', username: 'test', displayName: null },
          stickers: [],
          shares: [],
        },
      ];

      const mockStickers = [
        {
          id: 'sticker-new',
          ownerId: 'user-1',
          name: 'New Sticker',
          createdAt: recentDate,
          updatedAt: recentDate,
          deletedAt: null,
          owner: { id: 'user-1', username: 'test', displayName: null },
        },
        {
          id: 'sticker-updated',
          ownerId: 'user-1',
          name: 'Updated Sticker',
          createdAt: oldDate,
          updatedAt: recentDate,
          deletedAt: null,
          owner: { id: 'user-1', username: 'test', displayName: null },
        },
        {
          id: 'sticker-deleted',
          ownerId: 'user-1',
          name: 'Deleted Sticker',
          createdAt: oldDate,
          updatedAt: recentDate,
          deletedAt: recentDate,
          owner: { id: 'user-1', username: 'test', displayName: null },
        },
      ];

      (mockedPrisma.stickerPack.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockPacks);
      (mockedPrisma.sticker.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockStickers);

      const result = await service.sync({ userId: 'user-1', lastSyncAt });

      expect(result.stickerPacks.created).toHaveLength(1);
      expect(result.stickerPacks.created[0].id).toBe('pack-new');
      expect(result.stickerPacks.updated).toHaveLength(1);
      expect(result.stickerPacks.updated[0].id).toBe('pack-updated');
      expect(result.stickerPacks.deleted).toHaveLength(1);
      expect(result.stickerPacks.deleted[0].id).toBe('pack-deleted');

      expect(result.stickers.created).toHaveLength(1);
      expect(result.stickers.created[0].id).toBe('sticker-new');
      expect(result.stickers.updated).toHaveLength(1);
      expect(result.stickers.updated[0].id).toBe('sticker-updated');
      expect(result.stickers.deleted).toHaveLength(1);
      expect(result.stickers.deleted[0].id).toBe('sticker-deleted');
    });

    it('should include shared packs in sync', async () => {
      const now = new Date();
      const mockPacks = [
        {
          id: 'pack-shared',
          ownerId: 'user-2',
          name: 'Shared Pack',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          visibility: 'PRIVATE',
          owner: { id: 'user-2', username: 'other', displayName: null },
          stickers: [],
          shares: [{
            sharedWithId: 'user-1',
            permission: 'VIEW',
            expiresAt: null,
          }],
        },
      ];

      const mockStickers = [];

      (mockedPrisma.stickerPack.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockPacks);
      (mockedPrisma.sticker.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockStickers);

      const result = await service.sync({ userId: 'user-1' });

      expect(result.stickerPacks.created).toHaveLength(1);
      expect(result.stickerPacks.created[0].id).toBe('pack-shared');
    });

    it('should include stickers from accessible packs in sync', async () => {
      const now = new Date();
      const mockPacks = [];
      const mockStickers = [
        {
          id: 'sticker-in-pack',
          ownerId: 'user-2',
          name: 'Pack Sticker',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          owner: { id: 'user-2', username: 'other', displayName: null },
          stickerPacks: [{
            stickerPack: {
              id: 'pack-1',
              ownerId: 'user-2',
              visibility: 'PUBLIC',
            },
          }],
        },
      ];

      (mockedPrisma.stickerPack.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockPacks);
      (mockedPrisma.sticker.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockStickers);

      const result = await service.sync({ userId: 'user-1' });

      expect(result.stickers.created).toHaveLength(1);
      expect(result.stickers.created[0].id).toBe('sticker-in-pack');
    });
  });
});