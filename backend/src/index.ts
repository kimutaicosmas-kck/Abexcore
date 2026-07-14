import { createApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { NotificationService } from './services/notification.service';

const app = createApp();

app.listen(config.port, () => {
  logger.info(`ApexCore ERP v2.1.0 running on port ${config.port} [${config.nodeEnv}]`);
  logger.info(`API docs: http://localhost:${config.port}/api/docs`);

  if (config.nodeEnv === 'production') {
    NotificationService.runLowStockCheck().catch((err) =>
      logger.warn('Startup low-stock check failed', err)
    );
    setInterval(() => {
      NotificationService.runLowStockCheck().catch(() => undefined);
    }, 6 * 60 * 60 * 1000);
  }
});

export default app;
