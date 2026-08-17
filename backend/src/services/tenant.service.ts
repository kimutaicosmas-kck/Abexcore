import bcrypt from 'bcrypt';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { slugifyCompany, runWithoutTenant } from '../utils/tenant';
import { sanitizeCompanyBrand } from '../utils/platform';
import { PLATFORM_OWNER_SLUG } from '../config/platformOwner';
import { seedTenantDefaults } from '../utils/tenantSetup';
import { CompanyModulePreset, modulesForPreset } from '../config/companyModules';

const SALT_ROUNDS = 12;
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

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
      select: { id: true, slug: true, name: true, logo: true },
    });
    if (!company) throw new AppError('Company not found or inactive', 404);
    return sanitizeCompanyBrand(company);
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
