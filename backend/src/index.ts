import cluster from 'node:cluster';
import { createApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { NotificationService } from './services/notification.service';
import { AuthService } from './services/auth.service';
import { initMonitoring } from './utils/monitoring';
import prisma from './config/database';
import { forkWorkers, resolveClusterWorkers, shouldRunCluster } from './cluster';
import type { Server } from 'http';

process.env.TZ = config.timezone;

const clusterWorkers = resolveClusterWorkers();

async function runStartupMigrations() {
  await initMonitoring();
  await AuthService.migrateRefreshTokenHashes().catch((err) =>
    logger.warn('Refresh token hash migration skipped', err)
  );

  const { ensureLegacyRoleRenames } = await import('./utils/roleRenames');
  await ensureLegacyRoleRenames().catch((err) =>
    logger.warn('Legacy role rename skipped', err)
  );
}

function startBackgroundJobs() {
  NotificationService.runLowStockCheckForAllCompanies().catch((err) =>
    logger.warn('Startup low-stock check failed', err)
  );

  const lowStockIntervalMs =
    config.nodeEnv === 'production' ? 6 * 60 * 60 * 1000 : 60 * 60 * 1000;

  setInterval(() => {
    NotificationService.runLowStockCheckForAllCompanies().catch(() => undefined);
  }, lowStockIntervalMs).unref();
}

async function startWorker() {
  const app = createApp();
  const server: Server = app.listen(config.port, () => {
    const workerTag = clusterWorkers > 1 ? ` worker=${cluster.worker?.id ?? 'solo'}` : '';
    logger.info(
      `AbexCore ERP v2.1.0 running on port ${config.port} [${config.nodeEnv}] TZ=${config.timezone}${workerTag}`
    );
    if (config.swaggerEnabled) {
      logger.info(`API docs: http://localhost:${config.port}/api/docs`);
    }
  });

  server.requestTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.keepAliveTimeout = 65_000;

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
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

async function startPrimary() {
  await runStartupMigrations();
  startBackgroundJobs();
  forkWorkers(clusterWorkers);
}

async function bootstrap() {
  if (shouldRunCluster()) {
    await startPrimary();
    return;
  }

  await runStartupMigrations();

  if (clusterWorkers <= 1) {
    startBackgroundJobs();
  }

  await startWorker();
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

export default createApp();
