import { createApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { NotificationService } from './services/notification.service';
import { AuthService } from './services/auth.service';
import { initMonitoring } from './utils/monitoring';
import prisma from './config/database';
import type { Server } from 'http';

process.env.TZ = config.timezone;

let lowStockTimer: ReturnType<typeof setInterval> | undefined;

async function start() {
  await initMonitoring();
  await AuthService.migrateRefreshTokenHashes().catch((err) =>
    logger.warn('Refresh token hash migration skipped', err)
  );

  const app = createApp();
  const server: Server = app.listen(config.port, () => {
    logger.info(`ApexCore ERP v2.1.0 running on port ${config.port} [${config.nodeEnv}] TZ=${config.timezone}`);
    if (config.swaggerEnabled) {
      logger.info(`API docs: http://localhost:${config.port}/api/docs`);
    }

    NotificationService.runLowStockCheckForAllCompanies().catch((err) =>
      logger.warn('Startup low-stock check failed', err)
    );
    const lowStockIntervalMs =
      config.nodeEnv === 'production' ? 6 * 60 * 60 * 1000 : 60 * 60 * 1000;
    lowStockTimer = setInterval(() => {
      NotificationService.runLowStockCheckForAllCompanies().catch(() => undefined);
    }, lowStockIntervalMs);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    if (lowStockTimer) clearInterval(lowStockTimer);

    server.close(async () => {
      try {
        await prisma.$disconnect();
      } catch (error) {
        logger.warn('Prisma disconnect failed during shutdown', error);
      }
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

export default createApp();
