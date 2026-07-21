import { createApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { NotificationService } from './services/notification.service';
import { initMonitoring } from './utils/monitoring';

process.env.TZ = config.timezone;

async function start() {
  await initMonitoring();

  const app = createApp();

  app.listen(config.port, () => {
    logger.info(`ApexCore ERP v2.1.0 running on port ${config.port} [${config.nodeEnv}] TZ=${config.timezone}`);
    if (config.swaggerEnabled) {
      logger.info(`API docs: http://localhost:${config.port}/api/docs`);
    }

    if (config.nodeEnv === 'production') {
      NotificationService.runLowStockCheck().catch((err) =>
        logger.warn('Startup low-stock check failed', err)
      );
      setInterval(() => {
        NotificationService.runLowStockCheck().catch(() => undefined);
      }, 6 * 60 * 60 * 1000);
    }
  });
}

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

export default createApp();
