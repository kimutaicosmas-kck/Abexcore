import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function createCrudService<T extends keyof typeof prisma>(
  model: T,
  searchFields: string[] = ['name'],
  defaultInclude?: object
) {
  const delegate = prisma[model] as {
    findMany: (args: object) => Promise<unknown[]>;
    findUnique: (args: object) => Promise<unknown>;
    findFirst: (args: object) => Promise<unknown>;
    create: (args: object) => Promise<unknown>;
    update: (args: object) => Promise<unknown>;
    count: (args: object) => Promise<number>;
  };

  return {
    async list(params: PaginationParams & { where?: object } = {}) {
      const { page = 1, limit = 20, search, sortBy = 'createdAt', sortOrder = 'desc', where = {} } = params;
      const skip = (page - 1) * limit;

      const searchFilter = search
        ? {
            OR: searchFields.map((field) => ({
              [field]: { contains: search },
            })),
          }
        : {};

      const [data, total] = await Promise.all([
        delegate.findMany({
          where: { ...where, ...searchFilter, deletedAt: null },
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
          ...(defaultInclude ? { include: defaultInclude } : {}),
        }),
        delegate.count({
          where: { ...where, ...searchFilter, deletedAt: null },
        }),
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },

    async getById(id: string) {
      const item = await delegate.findFirst({
        where: { id, deletedAt: null },
        ...(defaultInclude ? { include: defaultInclude } : {}),
      });
      if (!item) throw new AppError(`${String(model)} not found`, 404);
      return item;
    },

    async create(data: object) {
      return delegate.create({
        data,
        ...(defaultInclude ? { include: defaultInclude } : {}),
      });
    },

    async update(id: string, data: object) {
      await this.getById(id);
      return delegate.update({
        where: { id },
        data,
        ...(defaultInclude ? { include: defaultInclude } : {}),
      });
    },

    async softDelete(id: string) {
      await this.getById(id);
      return delegate.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    },
  };
}
