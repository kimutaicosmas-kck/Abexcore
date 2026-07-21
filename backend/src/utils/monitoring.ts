import { config } from '../config';
import { logger } from '../config/logger';

let sentryReady = false;

export async function initMonitoring(): Promise<void> {
  if (!config.sentry.dsn) return;

  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: config.sentry.dsn,
      environment: config.nodeEnv,
      tracesSampleRate: config.nodeEnv === 'production' ? 0.1 : 0,
    });
    sentryReady = true;
    logger.info('Sentry monitoring enabled');
  } catch (err) {
    logger.warn('Sentry package not installed — skipping error monitoring', err);
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (sentryReady) {
    import('@sentry/node')
      .then((Sentry) => {
        if (context) Sentry.setContext('request', context);
        Sentry.captureException(err);
      })
      .catch(() => undefined);
  }
}
