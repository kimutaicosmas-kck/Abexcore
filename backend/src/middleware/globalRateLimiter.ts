import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config';

/** Per session when authenticated — avoids one office NAT IP starving all tenants. */
function rateLimitKey(req: Request): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return `user:${auth.slice(7, 48)}`;
  }

  const ip = req.ip || 'unknown';
  const company = req.headers['x-company-code'];
  if (typeof company === 'string' && company.trim()) {
    return `tenant:${company.trim().toLowerCase()}:${ip}`;
  }

  return `ip:${ip}`;
}

function rateLimitMax(req: Request): number {
  if (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
    return config.rateLimit.authenticatedMax;
  }
  return config.rateLimit.anonymousMax;
}

export function createGlobalRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: rateLimitMax,
    keyGenerator: rateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, message: 'Too many requests' },
    skip: (req) => {
      const p = req.path || '';
      return (
        p.startsWith('/api/health') ||
        p.includes('/realtime/events') ||
        p.startsWith('/api/v1/auth/')
      );
    },
  });
}
