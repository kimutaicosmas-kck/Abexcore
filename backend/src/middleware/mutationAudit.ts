import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { writeAuditLog } from '../utils/audit';
import { getParam } from '../utils/request';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Generic audit trail for module mutations (inventory, procurement, etc.). */
export function mutationAudit(module: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!MUTATION_METHODS.has(req.method)) return next();

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const entityId =
          (body as { data?: { id?: string } })?.data?.id ||
          getParam(req.params.id) ||
          undefined;
        const action =
          req.method === 'POST'
            ? 'create'
            : req.method === 'DELETE'
              ? 'delete'
              : 'update';

        void writeAuditLog({
          companyId: req.user.companyId,
          userId: req.user.id,
          module,
          action,
          entityType: req.path.split('/').filter(Boolean)[0] || module,
          entityId,
          newValues: req.method !== 'DELETE' ? (req.body as object) : undefined,
          ipAddress: req.ip,
        });
      }
      return originalJson(body);
    };

    next();
  };
}
