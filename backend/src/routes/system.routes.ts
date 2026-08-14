import { Router } from 'express';
import { authenticate, requirePlatformOwner } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getSystemMetrics } from '../services/systemMetrics.service';

const router = Router();

router.get(
  '/metrics',
  authenticate,
  requirePlatformOwner,
  asyncHandler(async (_req, res) => {
    const data = await getSystemMetrics();
    res.json({ success: true, data });
  })
);

export default router;
