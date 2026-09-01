import { Response } from 'express';
import { AuthService } from '../services/auth.service';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { sanitizeCompanyBrand } from '../utils/platform';

export const login = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, password, totpCode, companySlug } = req.body;
  const result = await AuthService.login(
    email,
    password,
    companySlug,
    totpCode,
    req.ip,
    req.headers['user-agent']
  );
  res.json({ success: true, data: result });
});

export const registerCompany = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { TenantService } = await import('../services/tenant.service');
  const { AuthService } = await import('../services/auth.service');
  const input = req.body;
  AuthService.validatePassword(input.adminPassword);
  const { company, admin } = await TenantService.registerCompany(input);
  res.status(201).json({
    success: true,
    data: {
      company: { id: company.id, slug: company.slug, name: company.name },
      admin: { id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName },
    },
    message: 'Company registered. Sign in with your company code and admin email.',
  });
});

export const resolveTenant = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { TenantService } = await import('../services/tenant.service');
  const slug = String(req.params.slug || '');
  const company = await TenantService.resolveTenant(slug);
  res.json({ success: true, data: company });
});
// refresh feature to happen in background
export const refresh = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { refreshToken } = req.body;
  const tokens = await AuthService.refreshToken(refreshToken);
  res.json({ success: true, data: tokens });
});

export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
  await AuthService.logout(req.user!.id, req.body.refreshToken);
  res.json({ success: true, message: 'Logged out successfully' });
});

export const me = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { prisma } = await import('../config/database');
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      role: true,
      department: true,
      branch: true,
      company: {
        select: {
          id: true,
          slug: true,
          name: true,
          logo: true,
          vatRate: true,
          currency: true,
          welcomeMessage: true,
          enabledModules: true,
          brandMode: true,
          brandPrimary: true,
          brandAccent: true,
          docPrimaryColor: true,
        },
      },
    },
  });
  const { passwordHash, twoFactorSecret, company, ...safeUser } = user!;

  let companyPayload = null;
  if (company) {
    const { ensureCompanyBrandColors } = await import('../utils/ensureCompanyBrand');
    const brand = await ensureCompanyBrandColors({
      id: company.id,
      slug: company.slug,
      brandMode: company.brandMode,
      brandPrimary: company.brandPrimary,
      brandAccent: company.brandAccent,
      docPrimaryColor: company.docPrimaryColor,
    });
    companyPayload = sanitizeCompanyBrand({
      id: company.id,
      slug: company.slug,
      name: company.name,
      logo: company.logo,
      vatRate: Number(company.vatRate),
      currency: company.currency,
      welcomeMessage: company.welcomeMessage,
      enabledModules: company.enabledModules,
      brandMode: brand.brandMode,
      brandPrimary: brand.brandPrimary,
      brandAccent: brand.brandAccent,
      docPrimaryColor: brand.docPrimaryColor,
    });
  }

  res.json({
    success: true,
    data: {
      ...safeUser,
      permissions: req.user!.permissions,
      company: companyPayload,
    },
  });
});

export const setup2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await AuthService.setup2FA(req.user!.id);
  res.json({ success: true, data: result });
});

export const verify2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { token } = req.body;
  const result = await AuthService.verify2FA(req.user!.id, token);
  res.json({ success: true, data: result });
});

export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  await AuthService.changePassword(req.user!.id, currentPassword, newPassword);
  res.json({ success: true, message: 'Password changed successfully' });
});

export const uploadAvatar = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { prisma } = await import('../config/database');
  const { processUserAvatar } = await import('../utils/image');
  const { config } = await import('../config');
  const { AppError } = await import('../middleware/errorHandler');
  const fs = await import('fs/promises');
  const path = await import('path');

  if (!req.file) throw new AppError('No photo uploaded', 400);

  const userId = req.user!.id;
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatar: true },
  });

  const filename = await processUserAvatar(req.file.path);
  const avatar = `/uploads/avatars/${filename}`;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatar },
    select: { id: true, avatar: true, firstName: true, lastName: true },
  });

  const previous = existing?.avatar;
  if (previous?.startsWith('/uploads/avatars/') && previous !== avatar) {
    const oldPath = path.resolve(config.uploadDir, previous.replace(/^\/uploads\//, ''));
    await fs.unlink(oldPath).catch(() => undefined);
  }

  res.json({ success: true, data: updated, message: 'Profile photo updated' });
});
