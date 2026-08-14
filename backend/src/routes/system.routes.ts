import { Router } from 'express';
import { authenticate, requirePlatformOwner } from '../middleware/auth';
import { getSystemMetrics } from '../services/systemMetrics.service';

const router = Router();

router.get('/metrics', authenticate, requirePlatformOwner, (_req, res) => {
  res.json({ success: true, data: getSystemMetrics() });
});

export default router;
