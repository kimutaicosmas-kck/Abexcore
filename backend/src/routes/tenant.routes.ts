import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest, requirePlatformOwner } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createUserSchema,
  companySettingsSchema,
  registerCompanySchema,
  deleteCompanySchema,
  resetDemoWorkspaceSchema,
} from '../validators/schemas';
import { getCompanySettings } from '../utils/company';
import { requireTenantId } from '../utils/tenant';
import { AuthService } from '../services/auth.service';
import { TenantService } from '../services/tenant.service';
import { NotificationService } from '../services/notification.service';
import { companyLogoUpload } from '../middleware/upload';
import { processCompanyLogo } from '../utils/image';
import prisma from '../config/database';
import { config } from '../config';
import { sanitizeCompanyBrand } from '../utils/platform';
import { getParam } from '../utils/request';
import { deleteCompanyCompletely } from '../services/companyDeletion.service';
import { resetPlatformDemoWorkspace } from '../services/platformDemoReset.service';
import { seedDemoDataForCompany } from '../services/demoDataSeed.service';
import { PLATFORM_OWNER_SLUG } from '../config/platformOwner';
import { runWithoutTenant } from '../utils/tenant';
import { auditLog } from '../middleware/auditLog';
import type { NextFunction } from 'express';
import multer from 'multer';

const router = Router();

function uploadCompanyLogo(fieldName: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    companyLogoUpload.single(fieldName)(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(new AppError(err.message, 400));
      }
      if (err instanceof Error && /multipart|boundary|file/i.test(err.message)) {
        return next(new AppError('Invalid file upload', 400));
      }
      next(err);
    });
  };
}

async function storeCompanyLogo(filePath: string): Promise<string> {
  const filename = await processCompanyLogo(filePath);
  return `/uploads/companies/${filename}`;
}

router.use(authenticate);

const getWorkspace = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const companyId = requireTenantId();
  const company = await getCompanySettings(companyId);
  if (!company) throw new AppError('Company not found', 404);

  const [userCount, activeUsers] = await Promise.all([
    prisma.user.count({ where: { companyId, deletedAt: null } }),
    prisma.user.count({ where: { companyId, deletedAt: null, status: 'ACTIVE' } }),
  ]);

  res.json({
    success: true,
    data: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      logo: company.logo,
      isActive: company.isActive,
      qualityModuleEnabled: company.qualityModuleEnabled,
      currency: company.currency,
      vatRate: Number(company.vatRate),
      userCount,
      activeUsers,
    },
  });
});

router.get('/workspace', authorize('settings:read'), getWorkspace);
/** Compatibility alias — validation probes used /company. */
router.get('/company', authorize('settings:read'), getWorkspace);

const workspaceSettingsSchema = companySettingsSchema.partial().extend({
  qualityModuleEnabled: z.boolean().optional(),
});

router.patch(
  '/workspace',
  authorize('settings:update'),
  validate(workspaceSettingsSchema),
  auditLog('tenant', 'update', 'company'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const company = await prisma.company.update({
      where: { id: companyId },
      data: req.body,
      include: { branches: true, taxRates: true },
    });
    res.json({ success: true, data: company });
  })
);

router.post(
  '/workspace/reset-demo',
  requirePlatformOwner,
  validate(resetDemoWorkspaceSchema),
  auditLog('tenant', 'delete', 'demo_data'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const result = await resetPlatformDemoWorkspace(companyId, req.body.confirmSlug);
    res.json({
      success: true,
      data: result,
      message:
        'Demo workspace reset complete. All transactional data has been removed; your login and workspace structure are unchanged.',
    });
  })
);

router.post(
  '/workspace/seed-demo',
  requirePlatformOwner,
  auditLog('tenant', 'create', 'demo_data'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const company = await prisma.company.findUnique({
      where: { id: requireTenantId() },
      select: { slug: true },
    });
    if (!company) throw new AppError('Company not found', 404);
    if (company.slug !== PLATFORM_OWNER_SLUG) {
      throw new AppError('Demo data is only available for the platform owner workspace', 403);
    }

    const summary = await runWithoutTenant(() => seedDemoDataForCompany(prisma, PLATFORM_OWNER_SLUG));
    const added = Object.values(summary).reduce((sum, row) => sum + row.added, 0);

    res.json({
      success: true,
      data: summary,
      message:
        added > 0
          ? `Demo data loaded. Added records across ${Object.keys(summary).length} modules (minimum 10 each where applicable).`
          : 'Demo data already meets the minimum of 10 records per module.',
    });
  })
);

router.post(
  '/invite-user',
  authorize('users:create'),
  validate(createUserSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const { password, modules, ...data } = req.body;
    const email = data.email.toLowerCase();
    const { normalizeAllowedModules } = await import('../utils/userPermissions');
    const { modulesForRoleName } = await import('../config/rolePermissions');

    const existing = await prisma.user.findFirst({
      where: { companyId, email },
    });
    if (existing && !existing.deletedAt) {
      throw new AppError(
        existing.status === 'INACTIVE'
          ? 'This email belongs to an inactive user. Reactivate them from Users, or restore from Recycle Bin if they were deleted.'
          : 'A user with this email already exists in your company. Use a different email or update the existing user under Users.',
        409
      );
    }

    const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { name: true } });
    if (!role) throw new AppError('Role not found', 400);
    if (role.name === 'Super Admin') {
      const { canAssignCompanySuperAdmin } = await import('../config/rolePermissions');
      if (!canAssignCompanySuperAdmin(req.user!.roleName)) {
        throw new AppError(
          'Only company Super Admin, Managing Director, or General Manager can assign Super Admin',
          403
        );
      }
      const { assertCanAssignSuperAdmin } = await import('../utils/superAdminQuota');
      await assertCanAssignSuperAdmin(companyId);
    }

    let allowedModules = normalizeAllowedModules(modules);
    if (!allowedModules?.length) {
      allowedModules = normalizeAllowedModules(modulesForRoleName(role.name));
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { slug: true, name: true, enabledModules: true },
    });
    const { clampModulesToCompany } = await import('../config/companyModules');
    allowedModules = clampModulesToCompany(allowedModules, company?.enabledModules);

    const passwordHash = await AuthService.hashPassword(password);
    const user = existing?.deletedAt
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            roleId: data.roleId,
            departmentId: data.departmentId,
            branchId: data.branchId,
            email,
            passwordHash,
            passwordChangedAt: new Date(),
            mustChangePassword: true,
            status: 'ACTIVE',
            deletedAt: null,
            allowedModules,
          },
          include: { role: true, department: true, branch: true },
        })
      : await prisma.user.create({
          data: {
            ...data,
            companyId,
            email,
            passwordHash,
            passwordChangedAt: new Date(),
            mustChangePassword: true,
            allowedModules,
          },
          include: { role: true, department: true, branch: true },
        });

    const restored = !!existing?.deletedAt;

    await NotificationService.notifyUser(
      user.id,
      'SYSTEM',
      `Welcome to ${company?.name || 'your workspace'}`,
      `Your account is ready. Sign in with company code "${company?.slug}" and your email ${email}. You will be asked to change your password on first login.`,
      '/login'
    );

    const { EmailService } = await import('../services/email.service');
    const emailSent = await EmailService.sendInviteEmail({
      to: email,
      firstName: data.firstName,
      companyName: company?.name || 'your workspace',
      companySlug: company?.slug || '',
      temporaryPassword: password,
      companyId,
    });

    const { passwordHash: _, twoFactorSecret, ...safeUser } = user;
    res.status(201).json({
      success: true,
      data: safeUser,
      emailSent,
      message: emailSent
        ? restored
          ? `User restored from Recycle Bin and welcome email sent to ${email}.`
          : `User invited and welcome email sent to ${email}.`
        : restored
          ? `User restored, but email was not sent. Configure SMTP under Settings → Email, then share login details manually.`
          : `User invited, but email was not sent. Configure SMTP under Settings → Email, then share the company code "${company?.slug}" and temporary password manually.`,
    });
  })
);

router.get(
  '/team',
  authorize('users:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const users = await prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        lastLoginAt: true,
        role: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: users });
  })
);

const companyStatusSchema = z.object({
  isActive: z.boolean(),
});

router.get(
  '/companies',
  requirePlatformOwner,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        logo: true,
        email: true,
        isActive: true,
        enabledModules: true,
        qualityModuleEnabled: true,
        brandMode: true,
        brandPrimary: true,
        brandAccent: true,
        docPrimaryColor: true,
        createdAt: true,
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    });

    res.json({
      success: true,
      data: companies.map(({ _count, ...company }) =>
        sanitizeCompanyBrand({
          ...company,
          userCount: _count.users,
        })
      ),
    });
  })
);

const companyModulesSchema = z.object({
  modulePreset: z.enum(['manufacturing', 'trading', 'custom']).optional(),
  enabledModules: z.union([z.array(z.string()), z.string()]).optional(),
}).refine(
  (body) => body.modulePreset != null || body.enabledModules != null,
  { message: 'Provide modulePreset and/or enabledModules' }
);

router.patch(
  '/companies/:id/modules',
  requirePlatformOwner,
  validate(companyModulesSchema),
  auditLog('tenant', 'update', 'company_modules'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = getParam(req.params.id);
    const company = await TenantService.updateCompanyModules(companyId, {
      modulePreset: req.body.modulePreset,
      enabledModules: req.body.enabledModules,
    });
    res.json({
      success: true,
      data: company,
      message: `Module access updated for ${company.name}.`,
    });
  })
);

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex color like #1e6bb8')
  .nullable()
  .optional();

const companyBrandingSchema = z.object({
  brandMode: z.enum(['abexcore', 'unique']).optional(),
  brandPrimary: hexColorSchema,
  brandAccent: hexColorSchema,
  docPrimaryColor: hexColorSchema,
  regenerate: z.boolean().optional(),
}).refine(
  (body) =>
    body.regenerate === true ||
    body.brandMode !== undefined ||
    body.brandPrimary !== undefined ||
    body.brandAccent !== undefined ||
    body.docPrimaryColor !== undefined,
  { message: 'Provide brandMode, brand colors, or regenerate: true' }
);

router.patch(
  '/companies/:id/branding',
  requirePlatformOwner,
  validate(companyBrandingSchema),
  auditLog('tenant', 'update', 'company_branding'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = getParam(req.params.id);
    const company = await TenantService.updateCompanyBranding(companyId, {
      brandMode: req.body.brandMode,
      brandPrimary: req.body.brandPrimary,
      brandAccent: req.body.brandAccent,
      docPrimaryColor: req.body.docPrimaryColor,
      regenerate: req.body.regenerate === true,
    });
    const modeLabel =
      company.brandMode === 'abexcore' ? 'AbexCore design' : 'unique design';
    res.json({
      success: true,
      data: company,
      message: req.body.regenerate
        ? `A new unique design was generated for ${company.name}.`
        : req.body.brandMode === 'abexcore'
          ? `${company.name} now uses the AbexCore design.`
          : `Brand updated for ${company.name} (${modeLabel}).`,
    });
  })
);

router.patch(
  '/companies/:id/status',
  requirePlatformOwner,
  validate(companyStatusSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = getParam(req.params.id);
    const target = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, slug: true },
    });
    if (!target) throw new AppError('Company not found', 404);
    if (target.slug === config.platformCompanySlug) {
      throw new AppError('Cannot change status of the platform company', 400);
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data: { isActive: req.body.isActive },
      select: {
        id: true,
        slug: true,
        name: true,
        logo: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: company });
  })
);

router.delete(
  '/companies/:id',
  requirePlatformOwner,
  validate(deleteCompanySchema),
  auditLog('tenant', 'delete', 'company'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = getParam(req.params.id);
    const target = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, slug: true, name: true },
    });
    if (!target) throw new AppError('Company not found', 404);
    if (target.slug === config.platformCompanySlug) {
      throw new AppError('The platform owner company cannot be deleted', 400);
    }
    if (req.body.confirmSlug.trim().toLowerCase() !== target.slug.toLowerCase()) {
      throw new AppError('Company code confirmation does not match', 400);
    }

    const deleted = await deleteCompanyCompletely(companyId);
    res.json({
      success: true,
      data: deleted,
      message: `Company "${deleted.name}" and all of its data have been permanently deleted.`,
    });
  })
);

router.post(
  '/companies',
  requirePlatformOwner,
  uploadCompanyLogo('logo'),
  auditLog('tenant', 'create', 'company'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = registerCompanySchema.parse({
      companyName: req.body.companyName,
      companySlug: req.body.companySlug || undefined,
      adminEmail: req.body.adminEmail,
      adminPassword: req.body.adminPassword,
      adminFirstName: req.body.adminFirstName,
      adminLastName: req.body.adminLastName,
      phone: req.body.phone || undefined,
      country: req.body.country || undefined,
      currency: req.body.currency || undefined,
      modulePreset: req.body.modulePreset || undefined,
      enabledModules: req.body.enabledModules || undefined,
    });

    AuthService.validatePassword(parsed.adminPassword);
    const logo = req.file ? await storeCompanyLogo(req.file.path) : undefined;
    const { company, admin } = await TenantService.registerCompany({ ...parsed, logo });

    res.status(201).json({
      success: true,
      data: {
        company: {
          id: company.id,
          slug: company.slug,
          name: company.name,
          logo: company.logo,
          enabledModules: company.enabledModules,
        },
        admin: { id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName },
      },
      message: `Company "${company.name}" registered. Admin can sign in with company code "${company.slug}".`,
    });
  })
);

router.post(
  '/logo',
  authorize('settings:update'),
  uploadCompanyLogo('logo'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) throw new AppError('No logo uploaded', 400);

    const companyId = requireTenantId();
    const tenant = await prisma.company.findUnique({
      where: { id: companyId },
      select: { slug: true },
    });
    if (tenant?.slug === config.platformCompanySlug) {
      throw new AppError('Platform company logo cannot be changed', 403);
    }

    const logo = await storeCompanyLogo(req.file.path);
    const company = await prisma.company.update({
      where: { id: companyId },
      data: { logo },
      select: { id: true, slug: true, name: true, logo: true },
    });

    res.json({ success: true, data: company });
  })
);

const emailConfigSchema = z.object({
  host: z.string().min(1).max(200),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().optional(),
  username: z.string().min(1).max(200),
  password: z.string().max(500).optional(),
  fromEmail: z.string().email().max(200),
  fromName: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
});

router.get(
  '/email-config',
  authorize('settings:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const { EmailService } = await import('../services/email.service');
    const status = await EmailService.getCompanyEmailStatus(companyId);
    res.json({ success: true, data: status });
  })
);

router.put(
  '/email-config',
  authorize('settings:update'),
  validate(emailConfigSchema),
  auditLog('tenant', 'update', 'email_config'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const { EmailService } = await import('../services/email.service');
    try {
      await EmailService.upsertCompanyEmailConfig(companyId, req.body);
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to save email settings', 400);
    }
    const status = await EmailService.getCompanyEmailStatus(companyId);
    res.json({ success: true, data: status, message: 'Email settings saved' });
  })
);

router.post(
  '/email-config/test',
  authorize('settings:update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const { EmailService } = await import('../services/email.service');
    const to =
      (typeof req.body?.to === 'string' && req.body.to.trim()) ||
      req.user?.email ||
      '';
    if (!to) throw new AppError('No recipient email available for the test', 400);
    if (!(await EmailService.isConfiguredForCompany(companyId))) {
      throw new AppError('Save SMTP settings first, then send a test email.', 400);
    }
    try {
      await EmailService.sendTestEmail(companyId, to);
    } catch (err) {
      // 400 (not 502): production errorHandler hides 5xx messages as "Internal server error".
      throw new AppError(err instanceof Error ? err.message : 'Test email failed', 400);
    }
    res.json({ success: true, data: { to }, message: `Test email sent to ${to}` });
  })
);

export default router;
