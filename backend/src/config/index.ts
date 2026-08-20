import dotenv from 'dotenv';
dotenv.config();

function requireSecret(name: string, value: string | undefined, devFallback: string): string {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set in production`);
  }
  return devFallback;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  timezone: process.env.TZ || 'Africa/Nairobi',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  swaggerEnabled: process.env.SWAGGER_ENABLED === 'true' || process.env.NODE_ENV !== 'production',
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
  },
  mpesa: {
    callbackSecret: process.env.MPESA_CALLBACK_SECRET || '',
  },
  jwt: {
    secret: requireSecret('JWT_SECRET', process.env.JWT_SECRET, 'dev-secret-change-me'),
    refreshSecret: requireSecret('JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET, 'dev-refresh-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  reportDir: process.env.REPORT_DIR || './reports',
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'AbexCore ERP <noreply@abexcore.co.ke>',
  },
  passwordPolicy: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
  },
  /** Company slug for the platform owner who can register new tenants. */
  platformCompanySlug: process.env.PLATFORM_COMPANY_SLUG || 'owner',
  encryption: {
    key: requireSecret(
      'DATA_ENCRYPTION_KEY',
      process.env.DATA_ENCRYPTION_KEY,
      'dev-encryption-key-change-in-production-32b'
    ),
  },
  /** 0 = auto (production: min(cpus, 4)). Default docker/prod uses 4. Set CLUSTER_WORKERS=1 to disable cluster. */
  clusterWorkers: parseInt(process.env.CLUSTER_WORKERS || '0', 10) || 0,
  redis: {
    /** Optional. When set, enables queue + Redis memory metrics. */
    url: process.env.REDIS_URL || '',
  },
  dbPool: {
    connectionLimit: parseInt(process.env.DB_POOL_CONNECTION_LIMIT || '10', 10),
    poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || '20', 10),
    connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10', 10),
  },
  rateLimit: {
    /** Authenticated API traffic — keyed per Bearer token, not shared office IP. */
    authenticatedMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10000', 10),
    anonymousMax: parseInt(process.env.RATE_LIMIT_ANON_MAX || '3000', 10),
  },
};
