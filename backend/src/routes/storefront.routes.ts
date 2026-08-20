import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { StorefrontService } from '../services/storefront.service';
import { getQuery } from '../utils/request';
import { requireTenantId } from '../utils/tenant';
import prisma from '../config/database';

const router = Router();

const checkoutSchema = z.object({
  customerName: z.string().min(2).max(120),
  customerPhone: z.string().min(9).max(20),
  customerEmail: z.string().email().optional(),
  customerAddress: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'MPESA']),
  mpesaPhone: z.string().min(9).max(15).optional(),
  notes: z.string().max(500).optional(),
});

router.patch(
  '/admin/enabled',
  authenticate,
  authorize('settings:update'),
  validate(z.object({ enabled: z.boolean() })),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await StorefrontService.setEnabled(Boolean(req.body.enabled));
    res.json({ success: true, data });
  })
);

router.get(
  '/admin/status',
  authenticate,
  authorize('settings:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, slug: true, name: true, storefrontEnabled: true },
    });
    res.json({ success: true, data: company });
  })
);

router.get(
  '/:slug',
  asyncHandler(async (req: Request, res: Response) => {
    const store = await StorefrontService.getStore(String(req.params.slug));
    res.json({ success: true, data: store });
  })
);

router.get(
  '/:slug/products',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await StorefrontService.listProducts(String(req.params.slug), {
      search: getQuery(req.query.search),
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 24,
    });
    res.json({ success: true, data: data.data, store: data.store, meta: data.meta });
  })
);

router.post(
  '/:slug/checkout',
  validate(checkoutSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await StorefrontService.checkout(String(req.params.slug), req.body);
    res.status(201).json({ success: true, data });
  })
);

export default router;
