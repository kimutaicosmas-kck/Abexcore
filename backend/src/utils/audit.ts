import prisma from '../config/database';

const ENTITY_FETCHERS: Record<string, (id: string) => Promise<object | null>> = {
  user: (id) => prisma.user.findUnique({ where: { id } }) as Promise<object | null>,
  customer: (id) => prisma.customer.findUnique({ where: { id } }) as Promise<object | null>,
  product: (id) => prisma.product.findUnique({ where: { id } }) as Promise<object | null>,
  sales_order: (id) => prisma.salesOrder.findUnique({ where: { id } }) as Promise<object | null>,
  invoice: (id) => prisma.invoice.findUnique({ where: { id } }) as Promise<object | null>,
  delivery_note: (id) => prisma.deliveryNote.findUnique({ where: { id } }) as Promise<object | null>,
  company: async (id) => prisma.company.findUnique({ where: { id } }),
};

const SENSITIVE_KEYS = ['password', 'passwordHash', 'currentPassword', 'newPassword', 'twoFactorSecret', 'token', 'refreshToken'];

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
