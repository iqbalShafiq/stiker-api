import { prisma } from '../prisma/client';
import { StickerVisibility } from '@prisma/client';
import { PUBLIC_PACK_INCLUDE, type PackWithPublicInclude } from '../utils/pack-query';

const FEATURED_WINDOW_HOURS = Math.max(1, parseInt(process.env.FEATURED_WINDOW_HOURS ?? '6', 10));

export class FeaturedService {
  async recomputeFeaturedPack(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - FEATURED_WINDOW_HOURS * 60 * 60 * 1000);

    const packs = await prisma.stickerPack.findMany({
      where: {
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
        OR: [
          { likes: { some: { createdAt: { gte: windowStart } } } },
          { saves: { some: { createdAt: { gte: windowStart } } } },
          { downloads: { some: { createdAt: { gte: windowStart } } } },
        ],
      },
      select: {
        id: true,
        likeCount: true,
        saveCount: true,
        downloadCount: true,
        likes: {
          where: { createdAt: { gte: windowStart } },
          select: { id: true },
        },
        saves: {
          where: { createdAt: { gte: windowStart } },
          select: { id: true },
        },
        downloads: {
          where: { createdAt: { gte: windowStart } },
          select: { id: true },
        },
      },
    });

    if (packs.length === 0) {
      return;
    }

    let bestPackId: string | null = null;
    let bestScore = -1;

    for (const pack of packs) {
      const score =
        pack.likes.length * 3 + pack.saves.length * 2 + pack.downloads.length * 1;
      if (score > bestScore) {
        bestScore = score;
        bestPackId = pack.id;
      }
    }

    if (!bestPackId || bestScore <= 0) {
      return;
    }

    const windowEnd = new Date(now.getTime() + FEATURED_WINDOW_HOURS * 60 * 60 * 1000);

    await prisma.featuredStickerPack.upsert({
      where: { stickerPackId: bestPackId },
      update: {
        score: bestScore,
        windowStart,
        windowEnd,
      },
      create: {
        stickerPackId: bestPackId,
        score: bestScore,
        windowStart,
        windowEnd,
      },
    });
  }

  async getTodayFeatured(): Promise<{
    featured: Awaited<ReturnType<typeof prisma.featuredStickerPack.findFirst>>;
    pack: PackWithPublicInclude;
    score: number;
    windowStart: Date;
    windowEnd: Date;
  } | null> {
    const now = new Date();
    const featured = await prisma.featuredStickerPack.findFirst({
      where: {
        windowEnd: { gte: now },
      },
      orderBy: { score: 'desc' },
      include: {
        stickerPack: {
          include: PUBLIC_PACK_INCLUDE,
        },
      },
    });

    if (!featured?.stickerPack) {
      return null;
    }

    return {
      featured,
      pack: featured.stickerPack,
      score: featured.score,
      windowStart: featured.windowStart,
      windowEnd: featured.windowEnd,
    };
  }
}

export const featuredService = new FeaturedService();

export function getFeaturedCronIntervalMs(): number {
  const hours = Math.max(1, parseInt(process.env.FEATURED_CRON_INTERVAL_HOURS ?? '6', 10));
  return hours * 60 * 60 * 1000;
}
