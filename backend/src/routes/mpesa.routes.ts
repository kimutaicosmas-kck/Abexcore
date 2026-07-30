import { Router, Request, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import { validate } from '../middleware/validate';
import { z } from 'zod';
import prisma from '../config/database';
import { getParam } from '../utils/request';
import { MpesaService } from '../services/mpesa.service';
import { FinancePaymentService } from '../services/finance.service';
import { config } from '../config';
import { requireIntegrationAvailable } from '../middleware/integrationGuard';

const router = Router();

const stkPushSchema = z.object({
  invoiceId: z.string().uuid(),
  phone: z.string().min(9),
  amount: z.number().min(1).optional(),
});

router.post(
  '/callback',
  asyncHandler(async (req: Request, res: Response) => {
    // Live Daraja must fail closed — callback secret is required outside stub mode.
    const isLiveMpesa =
      process.env.MPESA_ENV !== 'stub' && Boolean(process.env.MPESA_CONSUMER_KEY);
    if (isLiveMpesa && !config.mpesa.callbackSecret) {
      throw new AppError('M-Pesa callback secret is not configured', 503);
    }
    if (config.mpesa.callbackSecret) {
      const provided = req.headers['x-mpesa-callback-secret'];
      if (provided !== config.mpesa.callbackSecret) {
        throw new AppError('Invalid M-Pesa callback credentials', 401);
      }
    }
    const body = req.body as {
      Body?: {
        stkCallback?: {
          MerchantRequestID?: string;
          CheckoutRequestID?: string;
          ResultCode?: number;
          ResultDesc?: string;
          CallbackMetadata?: {
            Item?: { Name?: string; Value?: string | number }[];
          };
        };
      };
    };

    const callback = body.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) {
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
      return;
    }

    const txn = await prisma.mpesaTransaction.findUnique({
      where: { checkoutRequestId: callback.CheckoutRequestID },
    });

    if (!txn || !txn.invoiceId) {
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
      return;
    }

    if (txn.status === 'SUCCESS') {
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
      return;
    }

    const resultCode = String(callback.ResultCode ?? '');
    const isSuccess = resultCode === '0';

    if (!isSuccess) {
      await prisma.mpesaTransaction.update({
        where: { id: txn.id },
        data: {
          status: 'FAILED',
          resultCode,
          resultDesc: callback.ResultDesc || 'STK push failed',
        },
      });
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
      return;
    }

    const items = callback.CallbackMetadata?.Item || [];
    const receipt =
      items.find((item) => item.Name === 'MpesaReceiptNumber')?.Value?.toString() || undefined;
    const amountPaid = Number(
      items.find((item) => item.Name === 'Amount')?.Value || txn.amount
    );

    await prisma.$transaction(async (tx) => {
      const payment = await FinancePaymentService.recordPayment(tx, {
        invoiceId: txn.invoiceId!,
        amount: amountPaid,
        method: 'MPESA',
        reference: receipt || callback.CheckoutRequestID,
        notes: 'M-Pesa STK payment',
      });

      await tx.mpesaTransaction.update({
        where: { id: txn.id },
        data: {
          status: 'SUCCESS',
          resultCode,
          resultDesc: callback.ResultDesc || 'Success',
          mpesaReceiptNumber: receipt,
          paymentId: payment.id,
        },
      });
    });

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  })
);

router.use(authenticate);

router.get(
  '/status',
  authorize('finance:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json({
      success: true,
      data: { configured: MpesaService.isConfigured() },
    });
  })
);

router.post(
  '/stk-push',
  authorize('finance:create'),
  requireIntegrationAvailable('mpesa'),
  validate(stkPushSchema),
  auditLog('finance', 'create', 'mpesa_transaction'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { invoiceId, phone, amount: requestedAmount } = req.body as z.infer<typeof stkPushSchema>;

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (invoice.type !== 'SALES') throw new AppError('M-Pesa payments apply to sales invoices only', 400);

    const balance = Number(invoice.totalAmount) - Number(invoice.paidAmount);
    const amount = requestedAmount ?? balance;
    if (amount <= 0) throw new AppError('Invoice is already fully paid', 400);
    if (amount > balance + 0.01) {
      throw new AppError(`Amount exceeds invoice balance (KES ${balance.toFixed(2)})`, 400);
    }

    const normalizedPhone = MpesaService.normalizePhone(phone);
    const stk = await MpesaService.initiateStkPush({
      phone: normalizedPhone,
      amount,
      accountReference: invoice.invoiceNumber,
      description: `Payment for ${invoice.invoiceNumber}`,
    });

    const txn = await prisma.mpesaTransaction.create({
      data: {
        companyId: invoice.companyId,
        invoiceId,
        phone: normalizedPhone,
        amount,
        checkoutRequestId: stk.checkoutRequestId,
        merchantRequestId: stk.merchantRequestId,
        status: 'PENDING',
      },
    });

    res.status(201).json({ success: true, data: txn });
  })
);

router.get(
  '/transactions/:id',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const txn = await prisma.mpesaTransaction.findUnique({
      where: { id: getParam(req.params.id) },
      include: { invoice: { select: { invoiceNumber: true, status: true } }, payment: true },
    });
    if (!txn) throw new AppError('M-Pesa transaction not found', 404);
    res.json({ success: true, data: txn });
  })
);

export default router;
