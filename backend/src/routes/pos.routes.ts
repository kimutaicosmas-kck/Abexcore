import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { auditLog } from '../middleware/auditLog';
import { PosService } from '../services/pos.service';
import { MpesaService } from '../services/mpesa.service';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { requireIntegrationAvailable } from '../middleware/integrationGuard';

const router = Router();
router.use(authenticate);

const checkoutSchema = z.object({
  customerId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
        discount: z.number().min(0).max(100).optional(),
      })
    )
    .min(1),
  paymentMethod: z.enum(['CASH', 'MPESA', 'CARD', 'BANK_TRANSFER']),
  paymentReference: z.string().max(100).optional(),
  mpesaPhone: z.string().min(9).max(15).optional(),
  notes: z.string().max(500).optional(),
});

router.post(
  '/checkout',
  authorize('sales:create'),
  validate(checkoutSchema),
  auditLog('sales', 'create', 'pos_sale'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as z.infer<typeof checkoutSchema>;
    const result = await PosService.checkout({
      userId: req.user!.id,
      ...body,
    });

    if (result.awaitingMpesa && body.mpesaPhone && result.invoice) {
      try {
        const normalizedPhone = MpesaService.normalizePhone(body.mpesaPhone);
        const stk = await MpesaService.initiateStkPush({
          phone: normalizedPhone,
          amount: Number(result.invoice.totalAmount),
          accountReference: result.invoice.invoiceNumber,
          description: `POS ${result.order.orderNumber}`,
        });
        const txn = await prisma.mpesaTransaction.create({
          data: {
            companyId: result.invoice.companyId,
            invoiceId: result.invoice.id,
            phone: normalizedPhone,
            amount: Number(result.invoice.totalAmount),
            checkoutRequestId: stk.checkoutRequestId,
            merchantRequestId: stk.merchantRequestId,
            status: 'PENDING',
          },
        });
        res.status(201).json({
          success: true,
          data: { ...result, mpesaTransaction: txn },
        });
        return;
      } catch (err) {
        throw err instanceof AppError
          ? err
          : new AppError('POS sale saved but M-Pesa STK failed — collect payment manually', 502);
      }
    }

    res.status(201).json({ success: true, data: result });
  })
);

router.post(
  '/checkout/mpesa',
  authorize('sales:create'),
  requireIntegrationAvailable('mpesa'),
  validate(checkoutSchema),
  auditLog('sales', 'create', 'pos_sale'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    req.body.paymentMethod = 'MPESA';
    const body = req.body as z.infer<typeof checkoutSchema>;
    if (!body.mpesaPhone) throw new AppError('M-Pesa phone is required', 400);
    const result = await PosService.checkout({
      userId: req.user!.id,
      ...body,
      paymentMethod: 'MPESA',
    });
    res.status(201).json({ success: true, data: result });
  })
);

export default router;
