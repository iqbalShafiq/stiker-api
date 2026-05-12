import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProcessingHistoryService } from '../../../src/services/processing-history.service';
import { prisma } from '../../../src/prisma/client';

const mockedPrisma = vi.mocked(prisma);

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    processingHistory: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('ProcessingHistoryService', () => {
  const service = new ProcessingHistoryService();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HISTORY_EXPIRATION_DAYS = '7';
  });

  describe('create', () => {
    it('should create processing history with default expiration', async () => {
      const input = {
        userId: 'user-1',
        type: 'generate' as const,
        outputFiles: [{
          url: 'http://localhost:3000/uploads/test.png',
          path: 'test.png',
          filename: 'test.png',
          width: 512,
          height: 512,
        }],
      };

      const expectedExpiresAt = new Date();
      expectedExpiresAt.setDate(expectedExpiresAt.getDate() + 7);

      await service.create(input);

      expect(mockedPrisma.processingHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          type: 'generate',
          outputFiles: expect.anything(),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('should create processing history with custom expiration', async () => {
      process.env.HISTORY_EXPIRATION_DAYS = '14';
      
      const input = {
        userId: 'user-1',
        type: 'grid-split' as const,
        inputData: { rows: 2, cols: 2 },
        outputFiles: [{
          url: 'http://localhost:3000/uploads/test.png',
          path: 'test.png',
          filename: 'test.png',
        }],
      };

      await service.create(input);

      expect(mockedPrisma.processingHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          type: 'grid-split',
          inputData: expect.anything(),
          outputFiles: expect.anything(),
          expiresAt: expect.any(Date),
        }),
      });
    });
  });

  describe('findByUser', () => {
    it('should find history by user', async () => {
      const mockHistory = [
        { id: 'hist-1', userId: 'user-1', type: 'generate' },
        { id: 'hist-2', userId: 'user-1', type: 'grid-split' },
      ];

      (mockedPrisma.processingHistory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistory);

      const result = await service.findByUser('user-1');

      expect(result).toEqual(mockHistory);
      expect(mockedPrisma.processingHistory.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          expiresAt: {
            gt: expect.any(Date),
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });

    it('should filter by type', async () => {
      const mockHistory = [
        { id: 'hist-1', userId: 'user-1', type: 'generate' },
      ];

      (mockedPrisma.processingHistory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistory);

      const result = await service.findByUser('user-1', 'generate');

      expect(result).toEqual(mockHistory);
      expect(mockedPrisma.processingHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            type: 'generate',
          }),
        })
      );
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired records and return count', async () => {
      (mockedPrisma.processingHistory.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });

      const result = await service.deleteExpired();

      expect(result).toBe(5);
      expect(mockedPrisma.processingHistory.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lte: expect.any(Date),
          },
        },
      });
    });
  });

  describe('findExpired', () => {
    it('should find expired records', async () => {
      const mockExpired = [
        { id: 'hist-1', userId: 'user-1', type: 'generate', expiresAt: new Date('2024-01-01') },
      ];

      (mockedPrisma.processingHistory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockExpired);

      const result = await service.findExpired();

      expect(result).toEqual(mockExpired);
      expect(mockedPrisma.processingHistory.findMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lte: expect.any(Date),
          },
        },
      });
    });
  });
});