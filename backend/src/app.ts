import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './config';
import { createGlobalRateLimiter } from './middleware/globalRateLimiter';
import { apiLatencyMiddleware } from './middleware/apiLatency';
import { errorHandler, notFound } from './middleware/errorHandler';
import { isCorsOriginAllowed } from './utils/corsOrigins';
import { authenticate, requireSuperAdmin } from './middleware/auth';
import { authenticateUpload } from './middleware/uploadAuth';

import authRoutes from './routes/auth.routes';
import dashboardRoutes from './routes/dashboard.routes';
import usersRoutes from './routes/users.routes';
import customersRoutes from './routes/customers.routes';
import productsRoutes from './routes/products.routes';
import inventoryRoutes from './routes/inventory.routes';
import operationsRoutes from './routes/operations.routes';
import financeRoutes from './routes/finance.routes';
import expensesRoutes from './routes/expenses.routes';
import hrRoutes from './routes/hr.routes';
import deliveryRoutes from './routes/delivery.routes';
import crmRoutes from './routes/crm.routes';
import qualityRoutes from './routes/quality.routes';
import maintenanceRoutes from './routes/maintenance.routes';
import searchRoutes from './routes/search.routes';
import mpesaRoutes from './routes/mpesa.routes';
import realtimeRoutes from './routes/realtime.routes';
import tenantRoutes from './routes/tenant.routes';
import trashRoutes from './routes/trash.routes';
import systemRoutes from './routes/system.routes';
import platformRoutes from './routes/platform.routes';
import draftsRoutes from './routes/drafts.routes';

export function createApp() {
  const app = express();

  if (config.nodeEnv === 'production') {
    // Exactly 2 hops: Caddy → nginx → backend. Do not use `true` (ERR_ERL_PERMISSIVE_TRUST_PROXY).
    app.set('trust proxy', 2);
  }

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    ...(config.nodeEnv === 'production' ? { hsts: { maxAge: 31536000, includeSubDomains: true } } : {}),
  }));
  app.use(cors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      // Avoid turning CORS denials into unhandled 500s in the error middleware.
      callback(null, false);
    },
    credentials: true,
  }));
  app.use(compression({
    filter: (req, res) => {
      if (req.path.includes('/realtime/events')) return false;
      return compression.filter(req, res);
    },
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(apiLatencyMiddleware);

  // Global limiter: authenticated users get their own bucket (Bearer token key).
  // Auth login routes use dedicated limiters in auth.routes.
  if (config.nodeEnv !== 'test') {
    app.use(createGlobalRateLimiter());
  }

  // Uploads require auth (Bearer or ?access_token=). No directory listing.
  app.use(
    '/uploads',
    authenticateUpload,
    express.static(path.resolve(config.uploadDir), {
      index: false,
      dotfiles: 'deny',
      maxAge: config.nodeEnv === 'production' ? '7d' : 0,
      setHeaders: (res, filePath) => {
        const isCompanyLogo = /[/\\]companies[/\\]/i.test(filePath);
        res.setHeader(
          'Cache-Control',
          config.nodeEnv === 'production'
            ? isCompanyLogo
              ? 'public, max-age=604800'
              : 'private, max-age=604800'
            : 'no-cache'
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // Prefer not serving executable SVG as a script vector
        if (filePath.toLowerCase().endsWith('.svg')) {
          res.setHeader('Content-Type', 'image/svg+xml');
          res.setHeader('Content-Disposition', 'attachment');
        }
      },
    })
  );

  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'AbexCore ERP API',
        description: 'Enterprise ERP API — Designed by AbexCore Technologies',
        version: '2.1.0',
      },
      servers: [{ url: `/api/v1` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    apis: ['./src/routes/*.ts', './src/openapi/*.yaml'],
  });

  if (config.swaggerEnabled) {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  } else {
    app.get('/api/docs', authenticate, requireSuperAdmin, (_req, res) => {
      res.json({ success: true, message: 'Swagger UI disabled in production. Set SWAGGER_ENABLED=true to enable.' });
    });
  }

  app.get('/api/health/live', (_req, res) => {
    res.json({
      status: 'ok',
      version: '2.1.0',
      timezone: config.timezone,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/health/ready', async (_req, res) => {
    const { IntegrationRegistry } = await import('./services/integrations/registry');
    let database = 'connected';
    try {
      const { default: prismaClient } = await import('./config/database');
      await prismaClient.$queryRaw`SELECT 1`;
    } catch {
      database = 'disconnected';
    }

    const integrations = IntegrationRegistry.getStatuses();
    const ready = database === 'connected';

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      version: '2.1.0',
      database,
      integrations,
      timezone: config.timezone,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/health', async (_req, res) => {
    try {
      const { default: prismaClient } = await import('./config/database');
      const { IntegrationRegistry } = await import('./services/integrations/registry');
      await prismaClient.$queryRaw`SELECT 1`;
      res.json({
        status: 'ok',
        version: '2.1.0',
        database: 'connected',
        integrations: IntegrationRegistry.getStatuses(),
        timezone: config.timezone,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'degraded',
        version: '2.1.0',
        database: 'disconnected',
        timezone: config.timezone,
        timestamp: new Date().toISOString(),
      });
    }
  });

  const apiRouter = express.Router();
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/dashboard', dashboardRoutes);
  apiRouter.use('/users', usersRoutes);
  apiRouter.use('/customers', customersRoutes);
  apiRouter.use('/products', productsRoutes);
  apiRouter.use('/inventory', inventoryRoutes);
  apiRouter.use('/operations', operationsRoutes);
  // Mount nested finance modules before the general /finance router so they
  // are never swallowed by finance middleware / unmatched-route fallthrough.
  apiRouter.use('/finance/expenses', expensesRoutes);
  apiRouter.use('/finance/mpesa', mpesaRoutes);
  apiRouter.use('/finance', financeRoutes);
  apiRouter.use('/hr', hrRoutes);
  apiRouter.use('/delivery', deliveryRoutes);
  apiRouter.use('/crm', crmRoutes);
  apiRouter.use('/quality', qualityRoutes);
  apiRouter.use('/maintenance', maintenanceRoutes);
  apiRouter.use('/search', searchRoutes);
  apiRouter.use('/realtime', realtimeRoutes);
  apiRouter.use('/tenant', tenantRoutes);
  apiRouter.use('/trash', trashRoutes);
  apiRouter.use('/system', systemRoutes);
  apiRouter.use('/platform', platformRoutes);
  apiRouter.use('/drafts', draftsRoutes);

  app.use('/api/v1', apiRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp();
