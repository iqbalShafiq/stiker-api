import { prisma } from '../prisma/client';

export interface SyncInput {
  userId: string;
  lastSyncAt?: Date;
}

export interface SyncResult {
  stickerPacks: {
    created: Array<Record<string, unknown>>;
    updated: Array<Record<string, unknown>>;
    deleted: Array<{ id: string; deletedAt: Date }>;
  };
  stickers: {
    created: Array<Record<string, unknown>>;
    updated: Array<Record<string, unknown>>;
    deleted: Array<{ id: string; deletedAt: Date }>;
  };
  syncToken: string;
}

export class SyncService {
  async sync(input: SyncInput): Promise<SyncResult> {
    const lastSyncAt = input.lastSyncAt ?? new Date(0);
    const now = new Date();

    // Get all sticker packs accessible by user
    const stickerPacks = await prisma.stickerPack.findMany({
      where: {
        OR: [
          { ownerId: input.userId },
          { visibility: 'PUBLIC' },
          {
            shares: {
              some: {
                sharedWithId: input.userId,
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            },
          },
        ],
        updatedAt: {
          gte: lastSyncAt,
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
        },
        shares: {
          where: {
            sharedWithId: input.userId,
          },
        },
      },
    });

    const createdPacks = stickerPacks.filter(p => p.createdAt >= lastSyncAt && p.deletedAt === null);
    const updatedPacks = stickerPacks.filter(p => p.createdAt < lastSyncAt && p.updatedAt >= lastSyncAt && p.deletedAt === null);
    const deletedPacks = stickerPacks.filter(p => p.deletedAt !== null && p.deletedAt >= lastSyncAt);

    // Get all stickers accessible by user
    const stickers = await prisma.sticker.findMany({
      where: {
        OR: [
          { ownerId: input.userId },
          { visibility: 'PUBLIC' },
          {
            shares: {
              some: {
                sharedWithId: input.userId,
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            },
          },
          {
            stickerPacks: {
              some: {
                stickerPack: {
                  OR: [
                    { ownerId: input.userId },
                    { visibility: 'PUBLIC' },
                    {
                      shares: {
                        some: {
                          sharedWithId: input.userId,
                          OR: [
                            { expiresAt: null },
                            { expiresAt: { gt: new Date() } },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
        updatedAt: {
          gte: lastSyncAt,
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
      },
    });

    const createdStickers = stickers.filter(s => s.createdAt >= lastSyncAt && s.deletedAt === null);
    const updatedStickers = stickers.filter(s => s.createdAt < lastSyncAt && s.updatedAt >= lastSyncAt && s.deletedAt === null);
    const deletedStickers = stickers.filter(s => s.deletedAt !== null && s.deletedAt >= lastSyncAt);

    return {
      stickerPacks: {
        created: createdPacks,
        updated: updatedPacks,
        deleted: deletedPacks.map(p => ({ id: p.id, deletedAt: p.deletedAt! })),
      },
      stickers: {
        created: createdStickers,
        updated: updatedStickers,
        deleted: deletedStickers.map(s => ({ id: s.id, deletedAt: s.deletedAt! })),
      },
      syncToken: Buffer.from(now.toISOString()).toString('base64'),
    };
  }
}