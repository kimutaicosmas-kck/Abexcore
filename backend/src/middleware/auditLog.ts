import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from './auth';
import { getParam } from '../utils/request';
import { loadOldValues, redactBody } from '../utils/audit';

export const auditLog = (module: string, action: string, entityType: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const entityIdParam = getParam(req.params.id);
    let oldValues: object | undefined;

    if (entityIdParam && (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE')) {
      try {
        oldValues = await loadOldValues(entityType, entityIdParam);
      } catch {
        // non-blocking
      }
    }

    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const entityId =
          (body as { data?: { id?: string } })?.data?.id ||
          entityIdParam ||
          undefined;

        prisma.auditLog
          .create({
            data: {
              userId: req.user.id,
              action,
              module,
              entityType,
              entityId,
              oldValues,
              newValues: req.method !== 'DELETE' ? redactBody(req.body) : undefined,
              ipAddress: req.ip,
            },
          })
          .catch(console.error);
      }
      return originalJson(body);
    };

    next();
  };
};
