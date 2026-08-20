import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { WorkflowService } from '../services/workflow.service';
import { OutboxService } from '../services/outbox.service';
import { AnalyticsService } from '../services/analytics.service';
import { AssistantService } from '../services/assistant.service';
import { getParam } from '../utils/request';

const router = Router();
router.use(authenticate);

const requestApprovalSchema = z.object({
  entityType: z.enum([
    'purchase_order',
    'purchase_requisition',
    'leave_request',
    'salary_advance',
    'sales_order',
    'payment',
    'expense',
  ]),
  entityId: z.string().uuid(),
  title: z.string().min(3).max(200),
  metadata: z.record(z.unknown()).optional(),
});

const decideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(1000).optional(),
});

const assistantChatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(4000),
      })
    )
    .max(20)
    .optional(),
});

router.get(
  '/approvals',
  authorize('settings:read', 'users:read', 'procurement:approve', 'hr:approve', 'finance:approve'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const data = await WorkflowService.list(status);
    res.json({ success: true, data });
  })
);

router.post(
  '/approvals',
  authorize('settings:update', 'procurement:create', 'hr:create', 'sales:create', 'finance:create'),
  validate(requestApprovalSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await WorkflowService.requestApproval({
      ...req.body,
      requestedById: req.user!.id,
    });
    res.status(201).json({ success: true, data });
  })
);

router.post(
  '/approvals/:id/decide',
  authorize('settings:update', 'procurement:approve', 'hr:approve', 'finance:approve'),
  validate(decideSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await WorkflowService.decide({
      id: getParam(req.params.id),
      decidedById: req.user!.id,
      decision: req.body.decision,
      note: req.body.note,
    });
    res.json({ success: true, data });
  })
);

router.get(
  '/outbox/recent',
  authorize('settings:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await OutboxService.recent(30);
    res.json({ success: true, data });
  })
);

router.post(
  '/outbox/drain',
  authorize('settings:update'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const published = await OutboxService.drain(50);
    res.json({ success: true, data: { published } });
  })
);

router.get(
  '/analytics/summary',
  authorize('reports:read', 'finance:read', 'dashboard:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;
    const data = await AnalyticsService.executiveSummary({ from, to });
    res.json({ success: true, data });
  })
);

router.get(
  '/analytics/sales-trend',
  authorize('reports:read', 'finance:read', 'dashboard:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const days = req.query.days ? Number(req.query.days) : 30;
    const data = await AnalyticsService.salesTrend(days);
    res.json({ success: true, data });
  })
);

router.get(
  '/analytics/ar-aging',
  authorize('reports:read', 'finance:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await AnalyticsService.arAging();
    res.json({ success: true, data });
  })
);

router.post(
  '/assistant/chat',
  authorize('reports:read', 'dashboard:read', 'finance:read'),
  validate(assistantChatSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await AssistantService.chat(req.body);
    res.json({ success: true, data });
  })
);

router.get(
  '/assistant/status',
  authorize('reports:read', 'dashboard:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json({
      success: true,
      data: { llmConfigured: AssistantService.isLlmConfigured() },
    });
  })
);

export default router;
