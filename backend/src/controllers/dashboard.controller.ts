import { Response } from 'express';
import { DashboardService } from '../services/dashboard.service';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

export const getKPIs = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await DashboardService.getKPIs();
  res.json({ success: true, data });
});

export const getChartData = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await DashboardService.getChartData();
  res.json({ success: true, data });
});
