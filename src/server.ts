import app from './app';
import { config } from './config';
import logger from './utils/logger';
import { CleanupService } from './utils/cleanup';
import { closeRedis } from './utils/redis-client';
import { featuredService, getFeaturedCronIntervalMs } from './services/featured.service';
import { closeAiTracing, flushAiTracing } from './ai/tracing';

const server = app.listen(config.port, config.host, () => {
  logger.info(
    `Server running on ${config.host}:${config.port} in ${config.nodeEnv} mode`
  );

  const cleanupService = new CleanupService();
  const intervalMs = config.cleanupIntervalHours * 60 * 60 * 1000;
  void cleanupService.runCleanup().then((result) => {
    logger.info(result, 'Initial cleanup completed');
  }).catch((err) => {
    logger.error({ err }, 'Initial cleanup failed');
  });
  setInterval(() => {
    void cleanupService.runCleanup().then((result) => {
      logger.info(result, 'Scheduled cleanup completed');
    }).catch((err) => {
      logger.error({ err }, 'Scheduled cleanup failed');
    });
  }, intervalMs);

  const featuredIntervalMs = getFeaturedCronIntervalMs();
  void featuredService.recomputeFeaturedPack().catch((err) => {
    logger.error({ err }, 'Initial featured pack computation failed');
  });
  setInterval(() => {
    void featuredService.recomputeFeaturedPack().catch((err) => {
      logger.error({ err }, 'Scheduled featured pack computation failed');
    });
  }, featuredIntervalMs);
});

function gracefulShutdown(signal: string): void {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    void finalizeTracingAndExit();
  });
}

async function finalizeTracingAndExit(): Promise<void> {
  try {
    await flushAiTracing();
    await closeAiTracing();
  } catch (tracingError) {
    logger.error({ error: tracingError }, 'Failed to close AI tracing');
  }
  try {
    await closeRedis();
  } catch (redisError) {
    logger.error({ error: redisError }, 'Failed to close Redis client');
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void closeAiTracing()
    .catch(() => undefined)
    .finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
