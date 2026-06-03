import app from './app';
import { config } from './config';
import logger from './utils/logger';
import { CleanupService } from './utils/cleanup';
import { featuredService, getFeaturedCronIntervalMs } from './services/featured.service';

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

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
