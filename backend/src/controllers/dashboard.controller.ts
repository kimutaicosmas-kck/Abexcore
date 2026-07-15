import { Response } from 'express';
import { DashboardService } from '../services/dashboard.service';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

export const getKPIs = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await DashboardService.getKPIs(req.user!.id);
  res.json({ success: true, data });
});

export const getChartData = asyncHandler(async (req: AuthRequest, res: Response) => {
  const days = parseInt(req.query.days as string, 10) || 30;
  const data = await DashboardService.getChartData(days);
  res.json({ success: true, data });
});
