import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getParam } from '../utils/request';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import prisma from '../config/database';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

const upsertDraftSchema = z.object({
  payload: z.unknown(),
});

router.get(
  '/:moduleKey',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const moduleKey = getParam(req.params.moduleKey);
    if (!MODULE_KEY_PATTERN.test(moduleKey)) {
      throw new AppError('Invalid module key', 400);
    }

    const draft = await prisma.formDraft.findUnique({
      where: {
        companyId_userId_moduleKey: {
          companyId: requireTenantId(),
          userId: req.user!.id,
          moduleKey,
        },
      },
    });

    res.json({ success: true, data: draft });
  })
);

router.put(
  '/:moduleKey',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const moduleKey = getParam(req.params.moduleKey);
    if (!MODULE_KEY_PATTERN.test(moduleKey)) {
      throw new AppError('Invalid module key', 400);
    }

    const parsed = upsertDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid draft payload', 400);
    }

    const draft = await prisma.formDraft.upsert({
      where: {
        companyId_userId_moduleKey: {
          companyId: requireTenantId(),
          userId: req.user!.id,
          moduleKey,
        },
      },
      create: injectTenantData({
        userId: req.user!.id,
        moduleKey,
        payload: parsed.data.payload as object,
      }),
      update: {
        payload: parsed.data.payload as object,
      },
    });

    res.json({ success: true, data: draft });
  })
);

router.delete(
  '/:moduleKey',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const moduleKey = getParam(req.params.moduleKey);
    if (!MODULE_KEY_PATTERN.test(moduleKey)) {
      throw new AppError('Invalid module key', 400);
    }

    await prisma.formDraft.deleteMany({
      where: {
        companyId: requireTenantId(),
        userId: req.user!.id,
        moduleKey,
      },
    });

    res.json({ success: true });
  })
);

export default router;
