import path from 'path';
import fs from 'fs';
import { prisma } from '../prisma/client';
import { config } from '../config';
import logger from '../utils/logger';

export class AccountPurgeService {
  async enqueuePaths(paths: string[]): Promise<number> {
    const unique = [...new Set(paths.filter((p) => p && p.trim().length > 0))];
    if (unique.length === 0) return 0;

    await prisma.pendingStoragePurge.createMany({
      data: unique.map((filePath) => ({ filePath })),
      skipDuplicates: true,
    });
    return unique.length;
  }

  async runPendingPurges(): Promise<{ purged: number; failed: number }> {
    const pending = await prisma.pendingStoragePurge.findMany({
      where: { attempts: { lt: 5 } },
      orderBy: { scheduledAt: 'asc' },
      take: 200,
    });

    let purged = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const fullPath = path.isAbsolute(item.filePath)
          ? item.filePath
          : path.join(process.cwd(), config.uploadDir, item.filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
        await prisma.pendingStoragePurge.delete({ where: { id: item.id } });
        purged++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        await prisma.pendingStoragePurge.update({
          where: { id: item.id },
          data: { attempts: { increment: 1 }, lastError: message.slice(0, 500) },
        });
        logger.warn({ err: error, filePath: item.filePath }, 'Storage purge failed');
      }
    }

    return { purged, failed };
  }
}

export const accountPurgeService = new AccountPurgeService();
