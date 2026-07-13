import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { createUserSchema, updateUserSchema, paginationSchema } from '../validators/schemas';
import { AuthService } from '../services/auth.service';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(req.query);
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { email: { contains: search } },
            { firstName: { contains: search } },
            { lastName: { contains: search } },
          ],
          deletedAt: null,
        }
      : { deletedAt: null };

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: { role: true, department: true, branch: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: data.map(({ passwordHash, twoFactorSecret, ...u }) => u),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/roles',
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const roles = await prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
    });
    res.json({ success: true, data: roles });
  })
);

router.get(
  '/departments',
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const departments = await prisma.department.findMany({ where: { isActive: true } });
    res.json({ success: true, data: departments });
  })
);

router.get(
  '/audit-logs',
  authorize('users:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        skip,
        take: limit,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count(),
    ]);

    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: getParam(req.params.id), deletedAt: null },
      include: { role: true, department: true, branch: true, loginHistory: { take: 10, orderBy: { createdAt: 'desc' } } },
    });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    const { passwordHash, twoFactorSecret, ...safeUser } = user;
    res.json({ success: true, data: safeUser });
  })
);

router.post(
  '/',
  authorize('users:create'),
  validate(createUserSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { password, ...data } = req.body;
    const passwordHash = await AuthService.hashPassword(password);
    const user = await prisma.user.create({
      data: { ...data, email: data.email.toLowerCase(), passwordHash },
      include: { role: true, department: true },
    });
    const { passwordHash: _, twoFactorSecret, ...safeUser } = user;
    res.status(201).json({ success: true, data: safeUser });
  })
);

router.put(
  '/:id',
  authorize('users:update'),
  validate(updateUserSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { password, ...data } = req.body;
    const updateData = password
      ? { ...data, passwordHash: await AuthService.hashPassword(password) }
      : data;

    const user = await prisma.user.update({
      where: { id: getParam(req.params.id) },
      data: updateData,
      include: { role: true, department: true },
    });
    const { passwordHash, twoFactorSecret, ...safeUser } = user;
    res.json({ success: true, data: safeUser });
  })
);

router.delete(
  '/:id',
  authorize('users:delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.user.update({
      where: { id: getParam(req.params.id) },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    res.json({ success: true, message: 'User deactivated' });
  })
);

export default router;
