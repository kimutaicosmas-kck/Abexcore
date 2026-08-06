import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { loginRateLimiter, authRateLimiter } from '../middleware/rateLimiters';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { avatarUpload } from '../middleware/upload';
import {
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from '../validators/schemas';
import * as authController from '../controllers/auth.controller';
import { AuthRequest } from '../middleware/auth';

const router = Router();

function uploadAvatarFile(fieldName: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    avatarUpload.single(fieldName)(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('Photo must be under 2MB', 400));
        }
        return next(new AppError(err.message, 400));
      }
      if (err instanceof Error && /multipart|boundary|file/i.test(err.message)) {
        return next(new AppError('Invalid file upload. Use JPG, PNG, or WEBP under 2MB.', 400));
      }
      // Rejected by fileFilter
      return next(new AppError('Invalid photo type. Use JPG, PNG, or WEBP under 2MB.', 400));
    });
  };
}

router.get('/resolve-tenant/:slug', authController.resolveTenant);
router.post('/login', loginRateLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authRateLimiter, validate(refreshTokenSchema), authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/2fa/setup', authenticate, authController.setup2FA);
router.post('/2fa/verify', authenticate, authController.verify2FA);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);
router.post('/avatar', authenticate, uploadAvatarFile('avatar'), authController.uploadAvatar);

export default router;
