import cluster from 'node:cluster';
import os from 'node:os';
import { config } from './config';
import { logger } from './config/logger';

export function resolveClusterWorkers(): number {
  const explicit = parseInt(process.env.CLUSTER_WORKERS || '', 10);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, 8);
  }
  if (config.nodeEnv === 'production') {
    return Math.min(os.cpus().length, 4);
  }
  return 1;
}

export function shouldRunCluster(): boolean {
  return resolveClusterWorkers() > 1 && cluster.isPrimary;
}

export function forkWorkers(count: number): void {
  logger.info(`Starting ${count} API workers (cluster mode)`);

  for (let i = 0; i < count; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} exited (${code ?? signal}); restarting`);
    cluster.fork();
  });
}
