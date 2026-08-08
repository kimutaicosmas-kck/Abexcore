import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { captureException } from '../utils/monitoring';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

function mapPrismaError(err: Error): AppError | null {
  const anyErr = err as Error & {
    code?: string;
    meta?: { target?: string | string[]; column?: string };
    message?: string;
  };
  if (anyErr.code === 'P2022' || /Unknown column/i.test(anyErr.message || '')) {
    return new AppError(
      'Database schema is out of date. Restart the API container so schema sync can run (db push / migrate).',
      503
    );
  }
  if (anyErr.code !== 'P2002') return null;
  const target = Array.isArray(anyErr.meta?.target)
    ? anyErr.meta.target.join(',')
    : String(anyErr.meta?.target || '');
  if (target.includes('barcode')) {
    return new AppError('Barcode already exists on another product', 409);
  }
  if (target.includes('sku')) {
    return new AppError('Part number already exists', 409);
  }
  return new AppError('A record with those unique values already exists', 409);
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  let mapped: AppError | null = err instanceof AppError ? err : mapPrismaError(err);
  // express.json() SyntaxError must not surface as a masked 500 in production.
  if (!mapped && err instanceof SyntaxError && 'body' in err) {
    mapped = new AppError('Invalid JSON body', 400);
  }
  const finalErr = mapped || err;
  const statusCode = finalErr instanceof AppError ? finalErr.statusCode : 500;
  const message = finalErr.message || 'Internal server error';
  const meta = {
    statusCode,
    path: req.path,
    method: req.method,
    ...(finalErr instanceof AppError && finalErr.code ? { code: finalErr.code } : {}),
  };

  if (statusCode >= 500) {
    logger.error(message, { ...meta, stack: finalErr.stack });
    captureException(finalErr, meta);
  } else if (statusCode >= 400) {
    logger.warn(message, meta);
  }

  // Never leak stack traces to clients unless explicitly opted in (CF-01).
  // Server logs above already capture stacks for 5xx errors.
  const exposeStack = process.env.EXPOSE_ERROR_STACK === 'true';

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : message,
    ...(finalErr instanceof AppError && finalErr.code ? { code: finalErr.code } : {}),
    ...(exposeStack && finalErr.stack ? { stack: finalErr.stack } : {}),
  });
};

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' });
};
