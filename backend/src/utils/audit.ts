import prisma from '../config/database';

const ENTITY_FETCHERS: Record<string, (id: string) => Promise<object | null>> = {
  user: (id) => prisma.user.findUnique({ where: { id } }) as Promise<object | null>,
  customer: (id) => prisma.customer.findUnique({ where: { id } }) as Promise<object | null>,
  product: (id) => prisma.product.findUnique({ where: { id } }) as Promise<object | null>,
  sales_order: (id) => prisma.salesOrder.findUnique({ where: { id } }) as Promise<object | null>,
  invoice: (id) => prisma.invoice.findUnique({ where: { id } }) as Promise<object | null>,
  delivery_note: (id) => prisma.deliveryNote.findUnique({ where: { id } }) as Promise<object | null>,
  company: (id) => prisma.company.findUnique({ where: { id } }),
  goods_receipt: (id) => prisma.goodsReceipt.findUnique({ where: { id } }) as Promise<object | null>,
  purchase_order: (id) => prisma.purchaseOrder.findUnique({ where: { id } }) as Promise<object | null>,
  warehouse: (id) => prisma.warehouse.findUnique({ where: { id } }) as Promise<object | null>,
};

const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'twoFactorSecret',
  'token',
  'refreshToken',
];

export function redactBody(body: unknown): object | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const copy = { ...(body as Record<string, unknown>) };
  for (const key of SENSITIVE_KEYS) {
    if (key in copy) copy[key] = '[REDACTED]';
  }
  return copy;
}

export async function loadOldValues(entityType: string, entityId: string): Promise<object | undefined> {
  const fetcher = ENTITY_FETCHERS[entityType];
  if (!fetcher) return undefined;
  const record = await fetcher(entityId);
  return record ? redactBody(record) : undefined;
}

export async function writeAuditLog(data: {
  companyId?: string | null;
  userId?: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: object;
  newValues?: object;
  ipAddress?: string;
}) {
  if (!data.companyId) return;
  await prisma.auditLog.create({
    data: {
      companyId: data.companyId,
      userId: data.userId || undefined,
      module: data.module,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      oldValues: data.oldValues,
      newValues: data.newValues ? redactBody(data.newValues) : undefined,
      ipAddress: data.ipAddress,
    },
  });
}

/** Record authentication failures for security audit compliance. */
export async function auditAuthFailure(opts: {
  companyId?: string | null;
  userId?: string | null;
  email?: string;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  await writeAuditLog({
    companyId: opts.companyId || undefined,
    userId: opts.userId || undefined,
    module: 'auth',
    action: 'login_failed',
    entityType: 'user',
    entityId: opts.userId || undefined,
    newValues: {
      email: opts.email,
      reason: opts.reason,
      userAgent: opts.userAgent,
    },
    ipAddress: opts.ipAddress,
  }).catch(() => undefined);
}

export async function auditAuthSuccess(opts: {
  companyId: string;
  userId: string;
  ipAddress?: string;
}) {
  await writeAuditLog({
    companyId: opts.companyId,
    userId: opts.userId,
    module: 'auth',
    action: 'login_success',
    entityType: 'user',
    entityId: opts.userId,
    ipAddress: opts.ipAddress,
  }).catch(() => undefined);
}
