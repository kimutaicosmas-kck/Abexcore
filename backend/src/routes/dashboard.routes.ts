import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as dashboardController from '../controllers/dashboard.controller';

const router = Router();

router.use(authenticate);
router.get('/kpis', authorize('dashboard:read'), dashboardController.getKPIs);
router.get('/charts', authorize('dashboard:read'), dashboardController.getChartData);

export default router;
