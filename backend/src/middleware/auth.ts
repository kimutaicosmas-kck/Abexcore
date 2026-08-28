import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/database';
import { AppError } from './errorHandler';
import { runWithTenant } from '../utils/tenant';
import { resolveUserPermissionStrings } from '../utils/userPermissions';
import { canManageSalesTargets } from '../config/rolePermissions';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    roleId: string;
    roleName: string;
    companyId: string;
    companySlug?: string;
    permissions: string[];
  };
}

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
      roleId: string;
      companyId?: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId, status: 'ACTIVE', deletedAt: null },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
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
};

export const authorize = (...requiredPermissions: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));

    // Permissions are already clamped to the company package (including Super Admin).
    const hasPermission = requiredPermissions.some((p) =>
      req.user!.permissions.includes(p)
    );

    if (!hasPermission) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};

/** Read-only product lists for order/quote/inventory forms (not full catalog admin). */
export const authorizeProductPicker = authorize(
  'products:read',
  'sales:read',
  'production:read',
  'inventory:read',
  'customers:read'
);

export const requireSuperAdmin = (req: AuthRequest, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  if (req.user.roleName !== 'Super Admin') {
    return next(new AppError('Super Admin access required', 403));
  }
  next();
};

/** Company leadership / sales managers may assign monthly salesperson targets. */
export const requireSalesTargetManager = (req: AuthRequest, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  if (!canManageSalesTargets(req.user.roleName, req.user.permissions)) {
    return next(new AppError('Insufficient permissions to assign sales targets', 403));
  }
  next();
};

/** Only the platform owner (Super Admin of the platform company) can register tenants. */
export const requirePlatformOwner = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  if (req.user.roleName !== 'Super Admin') {
    return next(new AppError('Only the platform owner can perform this action', 403));
  }

  const company = await prisma.company.findUnique({
    where: { id: req.user.companyId },
    select: { slug: true, isActive: true },
  });

  if (!company?.isActive || company.slug !== config.platformCompanySlug) {
    return next(new AppError('Only the platform owner can perform this action', 403));
  }

  next();
};

export const authorizeAny = (...requiredPermissions: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));

    const hasPermission = requiredPermissions.some((p) =>
      req.user!.permissions.includes(p)
    );

    if (!hasPermission) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};

export function userHasPermission(user: AuthRequest['user'], permission: string): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}
