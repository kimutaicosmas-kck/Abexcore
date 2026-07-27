import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import { createUserSchema, updateUserSchema, userListQuerySchema, paginationSchema } from '../validators/schemas';
import { AuthService } from '../services/auth.service';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);

function sanitizeUser<T extends { passwordHash?: string; twoFactorSecret?: string | null }>(user: T) {
  const { passwordHash, twoFactorSecret, ...safeUser } = user;
  return safeUser;
}

router.get(
  '/stats',
  authorize('users:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const baseWhere = { deletedAt: null };

    const [total, active, inactive, suspended, roleCounts, recentLogins] = await Promise.all([
      prisma.user.count({ where: baseWhere }),
      prisma.user.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      prisma.user.count({ where: { ...baseWhere, status: 'INACTIVE' } }),
      prisma.user.count({ where: { ...baseWhere, status: 'SUSPENDED' } }),
      prisma.user.groupBy({
        by: ['roleId'],
        where: { ...baseWhere, status: 'ACTIVE' },
        _count: { id: true },
      }),
      prisma.user.count({
        where: {
          ...baseWhere,
          lastLoginAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const roles = await prisma.role.findMany({
      where: { id: { in: roleCounts.map((r) => r.roleId) } },
      select: { id: true, name: true },
    });

    res.json({
      success: true,
      data: {
        total,
        active,
        inactive,
        suspended,
        recentLogins,
        byRole: roleCounts.map((rc) => ({
          roleId: rc.roleId,
          roleName: roles.find((r) => r.id === rc.roleId)?.name || 'Unknown',
          count: rc._count.id,
        })),
      },
    });
  })
);

router.get(
  '/',
  authorize('users:read'),
  validate(userListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status, roleId } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
      roleId?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = { deletedAt: null };

    if (status) where.status = status;
    if (roleId) where.roleId = roleId;

    if (search) {
      where.OR = [
        { email: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ];
    }

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
      data: data.map(sanitizeUser),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/roles',
  authorize('users:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const roles = await prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: { where: { deletedAt: null, status: 'ACTIVE' } } } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: roles });
  })
);

router.get(
  '/departments',
  authorize('users:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const departments = await prisma.department.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.json({ success: true, data: departments });
  })
);

router.get(
  '/branches',
  authorize('users:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.json({ success: true, data: branches });
  })
);

router.get(
  '/audit-logs',
  authorize('users:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, cursor } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      cursor?: string;
    }>(req.query);

    const where: Prisma.AuditLogWhereInput = search
      ? {
          OR: [
            { action: { contains: search } },
            { module: { contains: search } },
            { entityType: { contains: search } },
            { user: { email: { contains: search } } },
          ],
        }
      : {};

    if (cursor) {
      const { buildCursorResult } = await import('../utils/cursorPagination');
      const rows = await prisma.auditLog.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const pageResult = buildCursorResult(rows, limit);
      res.json({
        success: true,
        data: pageResult.data,
        pagination: {
          limit: pageResult.limit,
          nextCursor: pageResult.nextCursor,
          prevCursor: pageResult.prevCursor,
          hasMore: pageResult.hasMore,
        },
      });
      return;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

router.get(
  '/:id',
  authorize('users:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: getParam(req.params.id), deletedAt: null },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        department: true,
        branch: true,
        loginHistory: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    res.json({ success: true, data: sanitizeUser(user) });
  })
);

router.post(
  '/',
  authorize('users:create'),
  validate(createUserSchema),
  auditLog('users', 'create', 'user'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { password, ...data } = req.body;

    const existing = await prisma.user.findFirst({
      where: { companyId: req.user!.companyId, email: data.email.toLowerCase() },
    });
    if (existing) throw new AppError('Email address is already in use', 409);

    const passwordHash = await AuthService.hashPassword(password);
    const user = await prisma.user.create({
      data: {
        ...data,
        companyId: req.user!.companyId,
        email: data.email.toLowerCase(),
        passwordHash,
        passwordChangedAt: new Date(),
      },
      include: { role: true, department: true, branch: true },
    });
    res.status(201).json({ success: true, data: sanitizeUser(user) });
  })
);

router.put(
  '/:id',
  authorize('users:update'),
  validate(updateUserSchema),
  auditLog('users', 'update', 'user'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const { password, email, ...data } = req.body;

    const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('User not found', 404);

    if (email && email.toLowerCase() !== existing.email) {
      const duplicate = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), deletedAt: null },
      });
      if (duplicate) throw new AppError('Email address is already in use', 409);
    }

    const updateData: Prisma.UserUpdateInput = {
      ...data,
      ...(email ? { email: email.toLowerCase() } : {}),
    };

    if (password) {
      updateData.passwordHash = await AuthService.hashPassword(password);
      updateData.passwordChangedAt = new Date();
    }

    if (data.status === 'ACTIVE') {
      updateData.deletedAt = null;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { role: true, department: true, branch: true },
    });
    res.json({ success: true, data: sanitizeUser(user) });
  })
);

router.delete(
  '/:id',
  authorize('users:delete'),
  auditLog('users', 'delete', 'user'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);

    if (req.user!.id === id) {
      throw new AppError('You cannot deactivate your own account', 400);
    }

    const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('User not found', 404);

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: id } });
    res.json({ success: true, message: 'User deactivated' });
  })
);

export default router;
