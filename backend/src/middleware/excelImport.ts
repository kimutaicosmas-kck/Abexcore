import { NextFunction, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from './auth';
import { AppError } from './errorHandler';
import { excelUpload } from './upload';

/** Parse multipart field `file` as an Excel workbook buffer. */
export function acceptExcelUpload(req: AuthRequest, res: Response, next: NextFunction) {
  excelUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400));
    }
    if (err) {
      return next(new AppError('Invalid spreadsheet upload. Use .xlsx under 10MB.', 400));
    }
    next();
  });
}
