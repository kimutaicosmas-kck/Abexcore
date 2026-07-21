import { Router, Response } from 'express';
import { authenticate, AuthRequest, userHasPermission } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import prisma from '../config/database';
import { getQuery } from '../utils/request';
import { searchQuerySchema } from '../validators/schemas';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate(searchQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { q } = getQuery<{ q?: string }>(req.query);
    const term = q?.trim();

    if (!term || term.length < 2) {
      res.json({ success: true, data: { customers: [], products: [], orders: [], suppliers: [] } });
      return;
    }

    const canCustomers = userHasPermission(req.user, 'customers:read');
    const canProducts = userHasPermission(req.user, 'products:read');
    const canSales = userHasPermission(req.user, 'sales:read');
    const canProcurement = userHasPermission(req.user, 'procurement:read');

    const [customers, products, orders, suppliers] = await Promise.all([
      canCustomers
        ? prisma.customer.findMany({
            where: {
              deletedAt: null,
              OR: [
                { name: { contains: term } },
                { code: { contains: term } },
                { email: { contains: term } },
              ],
            },
            take: 5,
            select: { id: true, code: true, name: true, type: true },
          })
        : Promise.resolve([]),
      canProducts
        ? prisma.product.findMany({
            where: {
              deletedAt: null,
              OR: [
                { name: { contains: term } },
                { sku: { contains: term } },
                { barcode: { contains: term } },
              ],
            },
            take: 5,
            select: { id: true, sku: true, name: true, category: true },
          })
        : Promise.resolve([]),
      canSales
        ? prisma.salesOrder.findMany({
            where: { orderNumber: { contains: term } },
            take: 5,
            include: { customer: { select: { name: true } } },
          })
        : Promise.resolve([]),
      canProcurement
        ? prisma.supplier.findMany({
            where: {
              deletedAt: null,
              OR: [
                { name: { contains: term } },
                { code: { contains: term } },
              ],
            },
            take: 5,
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        customers: customers.map((c) => ({ ...c, type: 'customer', href: '/customers' })),
        products: products.map((p) => ({ ...p, type: 'product', href: '/products' })),
        orders: orders.map((o) => ({
          id: o.id,
          label: o.orderNumber,
          sublabel: o.customer.name,
          type: 'order',
          href: `/sales?orderId=${o.id}`,
        })),
        suppliers: suppliers.map((s) => ({ ...s, type: 'supplier', href: '/procurement' })),
      },
    });
  })
);

export default router;
