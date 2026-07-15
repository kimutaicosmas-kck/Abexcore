import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';

import authRoutes from './routes/auth.routes';
import dashboardRoutes from './routes/dashboard.routes';
import usersRoutes from './routes/users.routes';
import customersRoutes from './routes/customers.routes';
import productsRoutes from './routes/products.routes';
import inventoryRoutes from './routes/inventory.routes';
import operationsRoutes from './routes/operations.routes';
import financeRoutes from './routes/finance.routes';
import hrRoutes from './routes/hr.routes';
import deliveryRoutes from './routes/delivery.routes';
import crmRoutes from './routes/crm.routes';
import qualityRoutes from './routes/quality.routes';
import maintenanceRoutes from './routes/maintenance.routes';
import searchRoutes from './routes/search.routes';
import mpesaRoutes from './routes/mpesa.routes';

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin: [config.frontendUrl, 'http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (config.nodeEnv === 'production') {
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 500,
        message: { success: false, message: 'Too many requests' },
      })
    );
  }

  app.use('/uploads', express.static(path.resolve(config.uploadDir)));

  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'ApexCore ERP API',
        description: 'Enterprise ERP API — Designed by ApexCore Technologies',
        version: '2.1.0',
      },
      servers: [{ url: `http://localhost:${config.port}/api/v1` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    apis: ['./src/routes/*.ts'],
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.get('/api/health', async (_req, res) => {
    try {
      const { default: prisma } = await import('./config/database');
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', version: '2.1.0', database: 'connected', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', version: '2.1.0', database: 'disconnected', timestamp: new Date().toISOString() });
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
  apiRouter.use('/finance', financeRoutes);
  apiRouter.use('/finance/mpesa', mpesaRoutes);
  apiRouter.use('/hr', hrRoutes);
  apiRouter.use('/delivery', deliveryRoutes);
  apiRouter.use('/crm', crmRoutes);
  apiRouter.use('/quality', qualityRoutes);
  apiRouter.use('/maintenance', maintenanceRoutes);
  apiRouter.use('/search', searchRoutes);

  app.use('/api/v1', apiRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp();
