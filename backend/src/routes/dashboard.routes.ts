import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as dashboardController from '../controllers/dashboard.controller';

const router = Router();

router.use(authenticate);
router.get('/kpis', dashboardController.getKPIs);
router.get('/charts', dashboardController.getChartData);

export default router;
