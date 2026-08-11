import { Router, Response } from 'express';
import {
  authenticate,
  authorizeAny,
  requireSuperAdmin,
  AuthRequest,
  userHasPermission,
} from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import { getParam, getQuery } from '../utils/request';
import {
  TrashService,
  TRASH_RESOURCES,
  TrashResource,
  getTrashResource,
} from '../services/trash.service';
import { paginationSchema } from '../validators/schemas';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const trashListQuerySchema = paginationSchema.extend({
  resource: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(TRASH_RESOURCES as [TrashResource, ...TrashResource[]]).optional()
  ),
});

function assertCanManageResource(req: AuthRequest, resource: TrashResource, action: 'delete' | 'update') {
  const config = getTrashResource(resource);
  const permission = `${config.module}:${action}`;
  if (
    !userHasPermission(req.user, permission) &&
    !userHasPermission(req.user, `${config.module}:delete`)
  ) {
    throw new AppError(`Insufficient permissions for ${config.label}`, 403);
  }
}

/** Soft-deleted master data (recycle bin). */
router.get(
  '/',
  authorizeAny(
    'users:delete',
    'customers:delete',
    'products:delete',
    'hr:delete',
    'procurement:delete',
    'inventory:delete',
    'settings:read'
  ),
  validate(trashListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, resource } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      resource?: TrashResource;
    }>(req.query);

    const canBrowseAll = userHasPermission(req.user, 'settings:read');
    const allowedResources = TRASH_RESOURCES.filter((key) => {
      if (canBrowseAll) return true;
      const config = getTrashResource(key);
      return userHasPermission(req.user, `${config.module}:delete`);
    });

    if (resource && !allowedResources.includes(resource)) {
      throw new AppError('Insufficient permissions for this trash resource', 403);
    }

    const data = await TrashService.list({
      page,
      limit,
      search,
      resource,
      resources: resource ? undefined : allowedResources,
    });
    res.json({
      success: true,
      ...data,
      resources: TrashService.listResources().filter((r) => allowedResources.includes(r.key)),
    });
  })
);

router.post(
  '/:resource/:id/restore',
  auditLog('settings', 'update', 'trash_restore'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const resource = getParam(req.params.resource) as TrashResource;
    const id = getParam(req.params.id);
    if (!TRASH_RESOURCES.includes(resource)) {
      throw new AppError('Unsupported trash resource', 400);
    }
    assertCanManageResource(req, resource, 'update');
    const data = await TrashService.restore(resource, id);
    res.json({ success: true, message: 'Restored from trash', data });
  })
);

/** Permanently delete — Super Admin only. */
router.delete(
  '/:resource/:id',
  requireSuperAdmin,
  auditLog('settings', 'delete', 'trash_purge'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const resource = getParam(req.params.resource) as TrashResource;
    const id = getParam(req.params.id);
    if (!TRASH_RESOURCES.includes(resource)) {
      throw new AppError('Unsupported trash resource', 400);
    }
    const data = await TrashService.purge(resource, id);
    res.json({ success: true, message: 'Permanently deleted', data });
  })
);

export default router;
