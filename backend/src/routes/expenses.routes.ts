import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createExpenseSchema,
  updateExpenseSchema,
  expenseDecisionSchema,
} from '../validators/schemas';
import { ExpenseService } from '../services/expense.service';
import { expenseReceiptUpload } from '../middleware/upload';
import { getParam } from '../utils/request';
import { endOfDay, startOfDay } from '../utils/date';

const router = Router();
router.use(authenticate);

router.get(
  '/categories',
  authorize('finance:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await ExpenseService.categories();
    res.json({ success: true, data });
  })
);

router.get(
  '/summary',
  authorize('finance:read', 'reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const from = typeof req.query.from === 'string' ? startOfDay(new Date(req.query.from)) : undefined;
    const to = typeof req.query.to === 'string' ? endOfDay(new Date(req.query.to)) : undefined;
    const data = await ExpenseService.summary(from, to);
    res.json({ success: true, data });
  })
);

router.get(
  '/',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const limit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const from = typeof req.query.from === 'string' ? startOfDay(new Date(req.query.from)) : undefined;
    const to = typeof req.query.to === 'string' ? endOfDay(new Date(req.query.to)) : undefined;
    const result = await ExpenseService.list({ status, search, from, to, page, limit });
    res.json({ success: true, ...result });
  })
);

router.get(
  '/:id',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.get(getParam(req.params.id));
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authorize('finance:create'),
  validate(createExpenseSchema),
  auditLog('finance', 'create', 'expense'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.create(req.body, req.user!.id);
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  '/:id',
  authorize('finance:update', 'finance:create'),
  validate(updateExpenseSchema),
  auditLog('finance', 'update', 'expense'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.update(getParam(req.params.id), req.body, req.user!.id);
    res.json({ success: true, data });
  })
);

router.post(
  '/:id/receipt',
  authorize('finance:create', 'finance:update'),
  expenseReceiptUpload.single('receipt'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) throw new AppError('Receipt file is required', 400);
    const receiptUrl = `/uploads/expenses/${req.file.filename}`;
    const data = await ExpenseService.attachReceipt(getParam(req.params.id), receiptUrl);
    res.json({ success: true, data, message: 'Receipt uploaded' });
  })
);

router.post(
  '/:id/submit',
  authorize('finance:create', 'finance:update'),
  auditLog('finance', 'update', 'expense'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.submit(getParam(req.params.id), req.user!.id);
    res.json({ success: true, data, message: 'Expense submitted for approval' });
  })
);

router.post(
  '/:id/decide',
  authorize('finance:approve', 'finance:update'),
  validate(expenseDecisionSchema),
  auditLog('finance', 'approve', 'expense'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.decide(
      getParam(req.params.id),
      req.body.decision,
      req.user!.id,
      req.body.note
    );
    res.json({
      success: true,
      data,
      message:
        req.body.decision === 'APPROVED'
          ? 'Expense approved and posted to the ledger'
          : 'Expense rejected',
    });
  })
);

router.post(
  '/:id/post',
  authorize('finance:approve', 'finance:update'),
  auditLog('finance', 'update', 'expense'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.approveAndPost(getParam(req.params.id), req.user!.id);
    res.json({ success: true, data, message: 'Expense posted to the ledger' });
  })
);

router.post(
  '/:id/void',
  authorize('finance:approve', 'finance:delete'),
  auditLog('finance', 'delete', 'expense'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.void(
      getParam(req.params.id),
      req.user!.id,
      typeof req.body?.reason === 'string' ? req.body.reason : undefined
    );
    res.json({ success: true, data, message: 'Expense voided and journal reversed' });
  })
);

router.delete(
  '/:id',
  authorize('finance:delete', 'finance:update'),
  auditLog('finance', 'delete', 'expense'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await ExpenseService.softDelete(getParam(req.params.id));
    res.json({ success: true, data });
  })
);

export default router;
