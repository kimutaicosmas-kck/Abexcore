import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/database';
import { AppError } from './errorHandler';
import { AuthRequest } from './auth';
import { runWithTenant } from '../utils/tenant';
import { resolveUserPermissionStrings } from '../utils/userPermissions';

/** Company logos must load on the public login page (no session yet). */
function isPublicCompanyLogo(req: AuthRequest): boolean {
  const pathOnly = (req.originalUrl || req.url || '').split('?')[0];
  return (
    /^\/uploads\/companies\//i.test(pathOnly) ||
    /^\/companies\//i.test(req.path || '')
  );
}

/**
 * Auth for /uploads — accepts Bearer header or ?access_token= (for <img src>).
 * Company logos under /uploads/companies/ are public (login / tenant branding).
 * All other uploads stay authenticated (audit S-01 / validation CF uploads risk).
 */
export async function authenticateUpload(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (isPublicCompanyLogo(req)) {
      return next();
    }

    const header = req.headers.authorization;
    const queryToken =
      typeof req.query.access_token === 'string' ? req.query.access_token : undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

    if (!token) {
      throw new AppError('Authentication required', 401);
    }

    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      companyId?: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId, status: 'ACTIVE', deletedAt: null },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        company: { select: { id: true, slug: true, isActive: true, enabledModules: true } },
      },
    });

    if (!user) throw new AppError('User not found or inactive', 401);
    if (!user.company?.isActive) throw new AppError('Company account is inactive', 403);
    if (decoded.companyId && decoded.companyId !== user.companyId) {
      throw new AppError('Session is not valid for this company', 401);
    }

    const permissions = await resolveUserPermissionStrings(user);
    req.user = {
      id: user.id,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      companyId: user.companyId,
      companySlug: user.company.slug,
      permissions,
    };

    runWithTenant({ companyId: user.companyId }, () => next());
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid or expired token', 401));
    } else {
      next(error);
    }
  }
}
