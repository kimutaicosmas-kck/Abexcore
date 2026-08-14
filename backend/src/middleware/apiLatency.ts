import { Request, Response, NextFunction } from 'express';
import { recordApiDuration } from '../utils/apiLatency';

/** Record end-to-end API response time for Server metrics. */
export function apiLatencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip noisy probes
  if (req.path.startsWith('/api/health') || req.path.startsWith('/api/docs')) {
    next();
    return;
  }

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    recordApiDuration(elapsedMs, res.statusCode);
  });
  next();
}
