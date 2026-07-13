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
import { logger } from './config/logger';
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

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { success: false, message: 'Too many requests' },
  })
);

app.use('/uploads', express.static(path.resolve(config.uploadDir)));

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Filter Manufacturing ERP API',
      version: '1.0.0',
      description: 'Enterprise ERP API for filter manufacturing company',
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
apiRouter.use('/hr', hrRoutes);
apiRouter.use('/delivery', deliveryRoutes);
apiRouter.use('/crm', crmRoutes);
apiRouter.use('/quality', qualityRoutes);
apiRouter.use('/maintenance', maintenanceRoutes);

app.use('/api/v1', apiRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port} [${config.nodeEnv}]`);
  logger.info(`API docs: http://localhost:${config.port}/api/docs`);
});

export default app;
