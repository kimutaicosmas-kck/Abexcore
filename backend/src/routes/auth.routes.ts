import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from '../validators/schemas';
import * as authController from '../controllers/auth.controller';

const router = Router();

router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshTokenSchema), authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/2fa/setup', authenticate, authController.setup2FA);
router.post('/2fa/verify', authenticate, authController.verify2FA);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

export default router;
