import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from './auth';
import { getParam } from '../utils/request';

export const auditLog = (module: string, action: string, entityType: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const entityId =
          (body as { data?: { id?: string } })?.data?.id ||
          getParam(req.params.id) ||
          undefined;

        prisma.auditLog
          .create({
            data: {
              userId: req.user.id,
              action,
              module,
              entityType,
              entityId,
              newValues: req.method !== 'DELETE' ? (req.body as object) : undefined,
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
