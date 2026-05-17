import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SocialService } from '../../../src/services/social.service';
import { prisma } from '../../../src/prisma/client';
import { StickerVisibility } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../../src/errors';

const mockedPrisma = vi.mocked(prisma);

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    stickerPack: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    stickerPackLike: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    stickerPackSave: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    stickerPackDownload: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    userFollow: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('SocialService', () => {
  const service = new SocialService();

  beforeEach(() => {
    vi.clearAllMocks();
    (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'pack-1',
      visibility: StickerVisibility.PUBLIC,
      deletedAt: null,
    });
    (mockedPrisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback) => callback(mockedPrisma));
  });

  it('likes a public pack once and increments count', async () => {
    (mockedPrisma.stickerPackLike.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockedPrisma.stickerPack.update as ReturnType<typeof vi.fn>).mockResolvedValue({ likeCount: 1 });

    const result = await service.likePack('pack-1', 'user-1');

    expect(result).toEqual({ liked: true, likeCount: 1 });
    expect(mockedPrisma.stickerPackLike.create).toHaveBeenCalledWith({
      data: { stickerPackId: 'pack-1', userId: 'user-1' },
    });
    expect(mockedPrisma.stickerPack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    });
  });

  it('does not increment like count when already liked', async () => {
    (mockedPrisma.stickerPackLike.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'like-1' });
    (mockedPrisma.stickerPack.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ likeCount: 3 });

    const result = await service.likePack('pack-1', 'user-1');

    expect(result).toEqual({ liked: true, likeCount: 3 });
    expect(mockedPrisma.stickerPackLike.create).not.toHaveBeenCalled();
    expect(mockedPrisma.stickerPack.update).not.toHaveBeenCalled();
  });

  it('unlikes a pack and decrements only when a row existed', async () => {
    (mockedPrisma.stickerPackLike.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (mockedPrisma.stickerPack.update as ReturnType<typeof vi.fn>).mockResolvedValue({ likeCount: 2 });

    const result = await service.unlikePack('pack-1', 'user-1');

    expect(result).toEqual({ liked: false, likeCount: 2 });
    expect(mockedPrisma.stickerPack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: { likeCount: { decrement: 1 } },
      select: { likeCount: true },
    });
  });

  it('records every download event', async () => {
    (mockedPrisma.stickerPack.update as ReturnType<typeof vi.fn>).mockResolvedValue({ downloadCount: 4 });

    const result = await service.recordPackDownload('pack-1', 'user-1');

    expect(result).toEqual({ downloaded: true, downloadCount: 4 });
    expect(mockedPrisma.stickerPackDownload.create).toHaveBeenCalledWith({
      data: { stickerPackId: 'pack-1', userId: 'user-1' },
    });
  });

  it('rejects social actions for non-public packs', async () => {
    (mockedPrisma.stickerPack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(service.likePack('pack-1', 'user-1')).rejects.toThrow(NotFoundError);
  });

  it('prevents following yourself', async () => {
    await expect(service.followUser('user-1', 'user-1')).rejects.toThrow(ValidationError);
  });

  it('follows a user and increments both counters', async () => {
    (mockedPrisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'user-2' });
    (mockedPrisma.userFollow.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockedPrisma.user.update as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ followerCount: 1 })
      .mockResolvedValueOnce({ followingCount: 1 });

    const result = await service.followUser('user-2', 'user-1');

    expect(result).toEqual({ following: true, followerCount: 1, followingCount: 1 });
    expect(mockedPrisma.userFollow.create).toHaveBeenCalledWith({
      data: { followerId: 'user-1', followingId: 'user-2' },
    });
  });
});
