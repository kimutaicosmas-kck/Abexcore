import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/** Set LOGIN_RATE_LIMIT_MAX=0 on the server to disable login throttling entirely. */
const loginMax = Math.max(0, parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '100', 10) || 0);

function loginKey(req: Request): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  // Prefer email so a shared office/NAT IP (or mis-detected proxy IP) does not lock everyone out.
  if (email) return `login:${email}`;
  return `login:${req.ip || 'unknown'}`;
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // Docker/Caddy/nginx forward headers; custom keys — skip ERL proxy validations.
  validate: false,
  message: { success: false, message: 'Too many authentication requests. Try again later.' },
});

/** Failed logins only (successful sign-in does not count). Keyed per email. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: loginMax || 1,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => loginMax === 0,
  keyGenerator: loginKey,
  validate: false,
  message: {
    success: false,
    message: 'Too many login attempts for this account. Wait a few minutes, then try again.',
  },
});
