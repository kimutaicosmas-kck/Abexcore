import { NextFunction, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from './auth';
import { AppError } from './errorHandler';
import { excelUpload } from './upload';
import { runWithTenant } from '../utils/tenant';

/** Parse multipart field `file` as an Excel/CSV buffer (max 10MB). */
export function acceptExcelUpload(req: AuthRequest, res: Response, next: NextFunction) {
  excelUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400));
    }
    if (err) {
      return next(new AppError('Invalid spreadsheet upload. Use .xlsx or .csv under 10MB.', 400));
    }
    // Multer finishes on a different async context and drops AsyncLocalStorage tenant.
    const companyId = req.user?.companyId;
    if (companyId) {
      return runWithTenant({ companyId }, () => next());
    }
    next();
  });
}
