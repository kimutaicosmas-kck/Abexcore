import bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { slugifyCompany, runWithoutTenant } from '../utils/tenant';
import { sanitizeCompanyBrand } from '../utils/platform';
import { PLATFORM_OWNER_SLUG } from '../config/platformOwner';
import { seedTenantDefaults } from '../utils/tenantSetup';
import {
  ABEXCORE_PLATFORM_PALETTE,
  generateCompanyBrandPalette,
  normalizeBrandMode,
  type CompanyBrandMode,
} from '../utils/companyBrandPalette';
import { CompanyModulePreset, modulesForPreset } from '../config/companyModules';

const SALT_ROUNDS = 12;
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

type TenantDb = Prisma.TransactionClient | typeof prisma;

async function syncSuperAdminLoginEmail(
  companyId: string,
  email: string | null | undefined,
  db: TenantDb = prisma
) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return;

  const superAdminRole = await db.role.findUnique({ where: { name: 'Super Admin' } });
  if (!superAdminRole) return;

  const admin = await db.user.findFirst({
    where: { companyId, roleId: superAdminRole.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });
  if (!admin || admin.email === normalized) return;

  const conflict = await db.user.findFirst({
    where: { companyId, email: normalized, deletedAt: null, id: { not: admin.id } },
  });
  if (conflict) {
    throw new AppError('Another user in this company already uses that email', 409);
  }

  await db.user.update({
    where: { id: admin.id },
    data: { email: normalized },
  });
}

function formatRegisteredCompany(
  company: {
    id: string;
    slug: string;
    name: string;
    logo: string | null;
    email: string | null;
    phone?: string | null;
    isActive: boolean;
    enabledModules: unknown;
    qualityModuleEnabled: boolean;
    brandMode: string;
    brandPrimary: string | null;
    brandAccent: string | null;
    docPrimaryColor: string | null;
    createdAt: Date;
    _count: { users: number };
  },
  adminLoginEmail?: string | null
) {
  const { _count, ...rest } = company;
  return sanitizeCompanyBrand({
    ...rest,
    userCount: _count.users,
    adminLoginEmail: adminLoginEmail ?? null,
  });
}

function parseModulesInput(raw: unknown): string[] | undefined {
  if (raw == null || raw === '') return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // comma-separated
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

type RegisterCompanyInput = {
  companyName: string;
  companySlug?: string;
  logo?: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
  phone?: string;
  country?: string;
  currency?: string;
  modulePreset?: CompanyModulePreset;
  enabledModules?: unknown;
};

export class TenantService {
  static async resolveTenant(slug: string) {
    const normalized = slug.trim().toLowerCase();
    if (!normalized) throw new AppError('Company code is required', 400);

    const company = await prisma.company.findFirst({
      where: { slug: normalized, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        logo: true,
        welcomeMessage: true,
        brandMode: true,
        brandPrimary: true,
        brandAccent: true,
        docPrimaryColor: true,
      },
    });
    if (!company) throw new AppError('Company not found or inactive', 404);

    const { ensureCompanyBrandColors } = await import('../utils/ensureCompanyBrand');
    const brand = await ensureCompanyBrandColors({
      id: company.id,
      slug: company.slug,
      brandMode: company.brandMode,
      brandPrimary: company.brandPrimary,
      brandAccent: company.brandAccent,
      docPrimaryColor: company.docPrimaryColor,
    });

    return sanitizeCompanyBrand({
      id: company.id,
      slug: company.slug,
      name: company.name,
      logo: company.logo,
      welcomeMessage: company.welcomeMessage,
      brandMode: brand.brandMode,
      brandPrimary: brand.brandPrimary,
      brandAccent: brand.brandAccent,
      docPrimaryColor: brand.docPrimaryColor,
    });
  }

  static resolvePackageModules(input: {
    modulePreset?: CompanyModulePreset;
    enabledModules?: unknown;
  }): string[] {
    const preset = input.modulePreset || 'manufacturing';
    const custom = parseModulesInput(input.enabledModules);
    return modulesForPreset(preset, custom);
  }

  static async registerCompany(input: RegisterCompanyInput) {
    const slug = slugifyCompany(input.companySlug || input.companyName);
    if (!slug) throw new AppError('Company code is required', 400);

    const existingSlug = await prisma.company.findUnique({ where: { slug } });
    if (existingSlug) throw new AppError('This company code is already taken', 409);

    const email = input.adminEmail.trim().toLowerCase();
    const superAdminRole = await prisma.role.findUnique({ where: { name: 'Super Admin' } });
    if (!superAdminRole) {
      throw new AppError('System roles are not initialized. Run database seed first.', 500);
    }

    const enabledModules = this.resolvePackageModules(input);
    const qualityModuleEnabled = enabledModules.includes('quality');
    const passwordHash = await bcrypt.hash(input.adminPassword, SALT_ROUNDS);

    return runWithoutTenant(() =>
      prisma.$transaction(async (tx) => {
        const companyName = input.companyName.trim();
        const brand = generateCompanyBrandPalette(slug);
        const company = await tx.company.create({
          data: {
            name: companyName,
            legalName: companyName,
            slug,
            logo: input.logo,
            isActive: true,
            country: input.country || 'Kenya',
            currency: input.currency || 'KES',
            phone: input.phone,
            email: email,
            enabledModules,
            qualityModuleEnabled,
            brandMode: 'unique',
            brandPrimary: brand.brandPrimary,
            brandAccent: brand.brandAccent,
            docPrimaryColor: brand.docPrimaryColor,
            welcomeMessage: `Welcome to ${companyName}. Your team workspace is ready — let's make today count.`,
          },
        });

      const branch = await tx.branch.create({
        data: {
          companyId: company.id,
          name: 'Head Office',
          code: 'HQ',
          isActive: true,
        },
      });

      await tx.warehouse.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          name: 'Raw Materials Warehouse',
          code: 'WH-RM',
          type: 'raw_materials',
          isActive: true,
        },
      });

      await tx.warehouse.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          name: 'Finished Goods Warehouse',
          code: 'WH-FG',
          type: 'finished_goods',
          isActive: true,
        },
      });

      await seedTenantDefaults(tx, company.id);

      const dept = await tx.department.findFirst({
        where: { companyId: company.id, name: 'Management' },
      });
      if (!dept) throw new AppError('Failed to initialize company departments', 500);

      const admin = await tx.user.create({
        data: {
          companyId: company.id,
          email,
          passwordHash,
          firstName: input.adminFirstName.trim(),
          lastName: input.adminLastName.trim(),
          phone: input.phone,
          roleId: superAdminRole.id,
          departmentId: dept.id,
          branchId: branch.id,
          status: 'ACTIVE',
        },
        include: { role: true, branch: true, department: true },
      });

      return { company, branch, admin };
      })
    );
  }

  static async updateCompanyProfile(
    companyId: string,
    input: {
      name?: string;
      slug?: string;
      email?: string | null;
      phone?: string | null;
      country?: string;
      currency?: string;
    }
  ) {
    return runWithoutTenant(async () => {
      const target = await prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, slug: true },
      });
      if (!target) throw new AppError('Company not found', 404);

      const data: {
        name?: string;
        legalName?: string;
        slug?: string;
        email?: string | null;
        phone?: string | null;
        country?: string;
        currency?: string;
      } = {};

      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length < 2) throw new AppError('Company name is required', 400);
        data.name = name;
        data.legalName = name;
      }

      if (input.slug !== undefined) {
        if (target.slug === PLATFORM_OWNER_SLUG) {
          throw new AppError('Platform company code cannot be changed', 400);
        }
        const slug = slugifyCompany(input.slug);
        if (!slug || slug.length < 2) throw new AppError('Company code is required', 400);
        if (slug === PLATFORM_OWNER_SLUG) {
          throw new AppError('This company code is reserved', 400);
        }
        if (slug !== target.slug) {
          const existing = await prisma.company.findUnique({ where: { slug } });
          if (existing) throw new AppError('This company code is already taken', 409);
        }
        data.slug = slug;
      }

      let nextEmail: string | null | undefined;
      if (input.email !== undefined) {
        const raw = input.email;
        nextEmail = raw && String(raw).trim() ? String(raw).trim().toLowerCase() : null;
        data.email = nextEmail;
      }
      if (input.phone !== undefined) {
        data.phone = input.phone?.trim() || null;
      }
      if (input.country !== undefined) {
        const country = input.country.trim();
        if (country) data.country = country;
      }
      if (input.currency !== undefined) {
        const currency = input.currency.trim();
        if (currency) data.currency = currency;
      }

      const company = await prisma.$transaction(async (tx) => {
        const updated = await tx.company.update({
          where: { id: companyId },
          data,
          select: {
            id: true,
            slug: true,
            name: true,
            logo: true,
            email: true,
            phone: true,
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

        if (input.email !== undefined) {
          await syncSuperAdminLoginEmail(companyId, nextEmail, tx);
        }

        return updated;
      });

      const adminLoginEmail =
        input.email !== undefined
          ? nextEmail
          : (
              await prisma.user.findFirst({
                where: {
                  companyId,
                  deletedAt: null,
                  role: { name: 'Super Admin' },
                },
                orderBy: { createdAt: 'asc' },
                select: { email: true },
              })
            )?.email ?? null;

      return formatRegisteredCompany(company, adminLoginEmail);
    });
  }

  static async syncCompanyAdminLoginEmail(
    companyId: string,
    email: string | null | undefined,
    db?: TenantDb
  ) {
    return syncSuperAdminLoginEmail(companyId, email, db);
  }

  static async listRegisteredCompanies() {
    return runWithoutTenant(async () => {
      const companies = await prisma.company.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          logo: true,
          email: true,
          phone: true,
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

      const adminUsers = await prisma.user.findMany({
        where: {
          deletedAt: null,
          role: { name: 'Super Admin' },
          companyId: { in: companies.map((company) => company.id) },
        },
        select: { companyId: true, email: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      const adminLoginByCompany = new Map<string, string>();
      for (const user of adminUsers) {
        if (!adminLoginByCompany.has(user.companyId)) {
          adminLoginByCompany.set(user.companyId, user.email);
        }
      }

      return companies.map((company) =>
        formatRegisteredCompany(company, adminLoginByCompany.get(company.id) ?? null)
      );
    });
  }

  static async updateCompanyModules(
    companyId: string,
    input: { modulePreset?: CompanyModulePreset; enabledModules?: unknown }
  ) {
    const target = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, slug: true },
    });
    if (!target) throw new AppError('Company not found', 404);
    if (target.slug === PLATFORM_OWNER_SLUG) {
      throw new AppError('Platform company modules cannot be changed', 400);
    }

    const modules = this.resolvePackageModules({
      modulePreset: input.modulePreset || (input.enabledModules != null ? 'custom' : 'manufacturing'),
      enabledModules: input.enabledModules,
    });

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        enabledModules: modules,
        qualityModuleEnabled: modules.includes('quality'),
      },
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

    const { _count, ...rest } = company;
    return sanitizeCompanyBrand({
      ...rest,
      userCount: _count.users,
    });
  }

  static async updateCompanyBranding(
    companyId: string,
    input: {
      brandMode?: CompanyBrandMode | string | null;
      brandPrimary?: string | null;
      brandAccent?: string | null;
      docPrimaryColor?: string | null;
      regenerate?: boolean;
    }
  ) {
    const target = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, slug: true },
    });
    if (!target) throw new AppError('Company not found', 404);
    if (target.slug === PLATFORM_OWNER_SLUG) {
      throw new AppError('Platform company branding cannot be changed here', 400);
    }

    const requestedMode = input.brandMode != null ? normalizeBrandMode(input.brandMode) : null;
    const useAbexcore = requestedMode === 'abexcore';
    const generated =
      !useAbexcore && input.regenerate
        ? generateCompanyBrandPalette(`${target.slug}-${Date.now()}`)
        : null;
    const nextMode: CompanyBrandMode = useAbexcore ? 'abexcore' : 'unique';

    const palette = useAbexcore
      ? ABEXCORE_PLATFORM_PALETTE
      : generated
        ? generated
        : null;

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        brandMode: nextMode,
        brandPrimary: palette
          ? palette.brandPrimary
          : input.brandPrimary === undefined
            ? undefined
            : input.brandPrimary,
        brandAccent: palette
          ? palette.brandAccent
          : input.brandAccent === undefined
            ? undefined
            : input.brandAccent,
        docPrimaryColor: palette
          ? palette.docPrimaryColor
          : input.docPrimaryColor === undefined
            ? undefined
            : input.docPrimaryColor,
      },
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

    const { _count, ...rest } = company;
    return sanitizeCompanyBrand({
      ...rest,
      userCount: _count.users,
    });
  }

  static async resolveCompanyBySlug(slug: string) {
    const company = await prisma.company.findFirst({
      where: { slug: slugifyCompany(slug), isActive: true },
    });
    if (!company) throw new AppError('Company not found or inactive', 404);
    return company;
  }

  static async ensureLegacyCompanySlug() {
    const company = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } });
    if (!company) return;
    if (!company.slug) {
      await prisma.company.update({
        where: { id: company.id },
        data: { slug: PLATFORM_OWNER_SLUG, isActive: true },
      });
    }
  }
}
