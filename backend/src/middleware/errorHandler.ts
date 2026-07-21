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

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || 'Internal server error';
  const meta = {
    statusCode,
    path: req.path,
    method: req.method,
    ...(err instanceof AppError && err.code ? { code: err.code } : {}),
  };

  if (statusCode >= 500) {
    logger.error(message, { ...meta, stack: err.stack });
    captureException(err, meta);
  } else if (statusCode >= 400) {
    logger.warn(message, meta);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(err instanceof AppError && err.code ? { code: err.code } : {}),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
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
