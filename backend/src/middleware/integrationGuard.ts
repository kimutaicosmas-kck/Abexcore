import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AppError } from './errorHandler';
import { IntegrationRegistry } from '../services/integrations/registry';

/** Fail fast when an external integration circuit is open — core ERP routes keep running. */
export function requireIntegrationAvailable(name: string) {
  return (_req: AuthRequest, _res: Response, next: NextFunction) => {
    if (IntegrationRegistry.isIntegrationOpen(name)) {
      return next(
        new AppError(
          `${name} is temporarily unavailable. Core ERP functions remain available — retry shortly.`,
          503
        )
      );
    }
    next();
  };
}
