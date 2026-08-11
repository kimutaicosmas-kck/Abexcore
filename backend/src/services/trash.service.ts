import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

export type TrashResource =
  | 'users'
  | 'customers'
  | 'products'
  | 'employees'
  | 'suppliers'
  | 'raw-materials';

type TrashResourceConfig = {
  label: string;
  /** Permission module used for soft-delete / restore (e.g. users → users:delete). */
  module: string;
  searchFields: string[];
  displayName: (row: Record<string, unknown>) => string;
  list: (args: {
    where: object;
    skip: number;
    take: number;
  }) => Promise<Record<string, unknown>[]>;
  count: (where: object) => Promise<number>;
  findDeleted: (id: string) => Promise<Record<string, unknown> | null>;
  restore: (id: string) => Promise<Record<string, unknown>>;
  purge: (id: string) => Promise<void>;
};

function asRecord(row: unknown): Record<string, unknown> {
  return (row || {}) as Record<string, unknown>;
}

const RESOURCES: Record<TrashResource, TrashResourceConfig> = {
  users: {
    label: 'Users',
    module: 'users',
    searchFields: ['firstName', 'lastName', 'email'],
    displayName: (row) =>
      `${row.firstName || ''} ${row.lastName || ''}`.trim() || String(row.email || row.id),
    list: ({ where, skip, take }) =>
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { deletedAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          deletedAt: true,
          role: { select: { id: true, name: true } },
        },
      }) as Promise<Record<string, unknown>[]>,
    count: (where) => prisma.user.count({ where }),
    findDeleted: (id) =>
      prisma.user.findFirst({
        where: { id, deletedAt: { not: null } },
        select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true },
      }) as Promise<Record<string, unknown> | null>,
    restore: (id) =>
      prisma.user.update({
        where: { id },
        data: { deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          deletedAt: true,
        },
      }) as Promise<Record<string, unknown>>,
    purge: async (id) => {
      await prisma.refreshToken.deleteMany({ where: { userId: id } });
      await prisma.loginHistory.deleteMany({ where: { userId: id } });
      await prisma.user.delete({ where: { id } });
    },
  },
  customers: {
    label: 'Customers',
    module: 'customers',
    searchFields: ['name', 'code', 'email'],
    displayName: (row) => String(row.name || row.code || row.id),
    list: ({ where, skip, take }) =>
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: { deletedAt: 'desc' },
        select: {
          id: true,
          code: true,
          name: true,
          email: true,
          isActive: true,
          deletedAt: true,
        },
      }) as Promise<Record<string, unknown>[]>,
    count: (where) => prisma.customer.count({ where }),
    findDeleted: (id) =>
      prisma.customer.findFirst({
        where: { id, deletedAt: { not: null } },
        select: { id: true, code: true, name: true, deletedAt: true },
      }) as Promise<Record<string, unknown> | null>,
    restore: (id) =>
      prisma.customer.update({
        where: { id },
        data: { deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true, isActive: true, deletedAt: true },
      }) as Promise<Record<string, unknown>>,
    purge: async (id) => {
      await prisma.customerContact.deleteMany({ where: { customerId: id } });
      await prisma.customer.delete({ where: { id } });
    },
  },
  products: {
    label: 'Products',
    module: 'products',
    searchFields: ['name', 'sku'],
    displayName: (row) => String(row.name || row.sku || row.id),
    list: ({ where, skip, take }) =>
      prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { deletedAt: 'desc' },
        select: {
          id: true,
          name: true,
          sku: true,
          isActive: true,
          deletedAt: true,
        },
      }) as Promise<Record<string, unknown>[]>,
    count: (where) => prisma.product.count({ where }),
    findDeleted: (id) =>
      prisma.product.findFirst({
        where: { id, deletedAt: { not: null } },
        select: { id: true, name: true, sku: true, deletedAt: true },
      }) as Promise<Record<string, unknown> | null>,
    restore: (id) =>
      prisma.product.update({
        where: { id },
        data: { deletedAt: null, isActive: true },
        select: { id: true, name: true, sku: true, isActive: true, deletedAt: true },
      }) as Promise<Record<string, unknown>>,
    purge: async (id) => {
      await prisma.product.delete({ where: { id } });
    },
  },
  employees: {
    label: 'Employees',
    module: 'hr',
    searchFields: ['firstName', 'lastName', 'employeeNo', 'email'],
    displayName: (row) =>
      `${row.firstName || ''} ${row.lastName || ''}`.trim() || String(row.employeeNo || row.id),
    list: ({ where, skip, take }) =>
      prisma.employee.findMany({
        where,
        skip,
        take,
        orderBy: { deletedAt: 'desc' },
        select: {
          id: true,
          employeeNo: true,
          firstName: true,
          lastName: true,
          email: true,
          isActive: true,
          deletedAt: true,
        },
      }) as Promise<Record<string, unknown>[]>,
    count: (where) => prisma.employee.count({ where }),
    findDeleted: (id) =>
      prisma.employee.findFirst({
        where: { id, deletedAt: { not: null } },
        select: { id: true, employeeNo: true, firstName: true, lastName: true, deletedAt: true },
      }) as Promise<Record<string, unknown> | null>,
    restore: (id) =>
      prisma.employee.update({
        where: { id },
        data: { deletedAt: null, isActive: true },
        select: {
          id: true,
          employeeNo: true,
          firstName: true,
          lastName: true,
          isActive: true,
          deletedAt: true,
        },
      }) as Promise<Record<string, unknown>>,
    purge: async (id) => {
      await prisma.employee.delete({ where: { id } });
    },
  },
  suppliers: {
    label: 'Suppliers',
    module: 'procurement',
    searchFields: ['name', 'code', 'email'],
    displayName: (row) => String(row.name || row.code || row.id),
    list: ({ where, skip, take }) =>
      prisma.supplier.findMany({
        where,
        skip,
        take,
        orderBy: { deletedAt: 'desc' },
        select: {
          id: true,
          code: true,
          name: true,
          email: true,
          isActive: true,
          deletedAt: true,
        },
      }) as Promise<Record<string, unknown>[]>,
    count: (where) => prisma.supplier.count({ where }),
    findDeleted: (id) =>
      prisma.supplier.findFirst({
        where: { id, deletedAt: { not: null } },
        select: { id: true, code: true, name: true, deletedAt: true },
      }) as Promise<Record<string, unknown> | null>,
    restore: (id) =>
      prisma.supplier.update({
        where: { id },
        data: { deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true, isActive: true, deletedAt: true },
      }) as Promise<Record<string, unknown>>,
    purge: async (id) => {
      await prisma.supplier.delete({ where: { id } });
    },
  },
  'raw-materials': {
    label: 'Raw materials',
    module: 'inventory',
    searchFields: ['name', 'code'],
    displayName: (row) => String(row.name || row.code || row.id),
    list: ({ where, skip, take }) =>
      prisma.rawMaterial.findMany({
        where,
        skip,
        take,
        orderBy: { deletedAt: 'desc' },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          deletedAt: true,
        },
      }) as Promise<Record<string, unknown>[]>,
    count: (where) => prisma.rawMaterial.count({ where }),
    findDeleted: (id) =>
      prisma.rawMaterial.findFirst({
        where: { id, deletedAt: { not: null } },
        select: { id: true, code: true, name: true, deletedAt: true },
      }) as Promise<Record<string, unknown> | null>,
    restore: (id) =>
      prisma.rawMaterial.update({
        where: { id },
        data: { deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true, isActive: true, deletedAt: true },
      }) as Promise<Record<string, unknown>>,
    purge: async (id) => {
      await prisma.rawMaterial.delete({ where: { id } });
    },
  },
};

export const TRASH_RESOURCES = Object.keys(RESOURCES) as TrashResource[];

export function getTrashResource(resource: string): TrashResourceConfig {
  const config = RESOURCES[resource as TrashResource];
  if (!config) throw new AppError(`Unsupported trash resource: ${resource}`, 400);
  return config;
}

function buildSearchWhere(config: TrashResourceConfig, search?: string) {
  if (!search?.trim()) return {};
  return {
    OR: config.searchFields.map((field) => ({
      [field]: { contains: search.trim() },
    })),
  };
}

export class TrashService {
  static listResources() {
    return TRASH_RESOURCES.map((key) => ({
      key,
      label: RESOURCES[key].label,
      module: RESOURCES[key].module,
    }));
  }

  static async list(params: {
    resource?: TrashResource;
    page?: number;
    limit?: number;
    search?: string;
    resources?: TrashResource[];
  }) {
    const page = params.page || 1;
    const limit = Math.min(params.limit || 20, 100);
    const skip = (page - 1) * limit;
    const keys = params.resource
      ? [params.resource]
      : params.resources?.length
        ? params.resources
        : TRASH_RESOURCES;

    const singleResource = Boolean(params.resource);

    const buckets = await Promise.all(
      keys.map(async (key) => {
        const config = RESOURCES[key];
        const where = {
          deletedAt: { not: null },
          ...buildSearchWhere(config, params.search),
        };
        // Combined feed needs a full (bounded) set per resource before merge/sort.
        const take = singleResource ? limit : Math.min(200, limit * page + limit);
        const listSkip = singleResource ? skip : 0;
        const [rows, total] = await Promise.all([
          config.list({ where, skip: listSkip, take }),
          config.count(where),
        ]);
        return {
          resource: key,
          label: config.label,
          total,
          items: rows.map((row) => ({
            id: String(row.id),
            resource: key,
            label: config.label,
            name: config.displayName(asRecord(row)),
            deletedAt: row.deletedAt,
            meta: row,
          })),
        };
      })
    );

    if (params.resource) {
      const bucket = buckets[0];
      return {
        resource: params.resource,
        data: bucket.items,
        pagination: {
          page,
          limit,
          total: bucket.total,
          totalPages: Math.ceil(bucket.total / limit) || 1,
        },
        summary: buckets.map(({ resource, label, total }) => ({ resource, label, total })),
      };
    }

    // Combined feed (newest first across resources)
    const combined = buckets
      .flatMap((b) => b.items)
      .sort((a, b) => {
        const da = a.deletedAt ? new Date(String(a.deletedAt)).getTime() : 0;
        const db = b.deletedAt ? new Date(String(b.deletedAt)).getTime() : 0;
        return db - da;
      });
    const total = buckets.reduce((sum, b) => sum + b.total, 0);
    const data = combined.slice(skip, skip + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary: buckets.map(({ resource, label, total: t }) => ({ resource, label, total: t })),
    };
  }

  static async restore(resource: TrashResource, id: string) {
    const config = getTrashResource(resource);
    const existing = await config.findDeleted(id);
    if (!existing) throw new AppError(`${config.label} item not found in trash`, 404);
    return config.restore(id);
  }

  static async purge(resource: TrashResource, id: string) {
    const config = getTrashResource(resource);
    const existing = await config.findDeleted(id);
    if (!existing) throw new AppError(`${config.label} item not found in trash`, 404);
    try {
      await config.purge(id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new AppError(
          `Cannot permanently delete this ${config.label.toLowerCase()} because related records still reference it`,
          409
        );
      }
      throw err;
    }
    return { id, resource };
  }
}
