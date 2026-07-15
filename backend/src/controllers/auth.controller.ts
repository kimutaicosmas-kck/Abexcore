import { Response } from 'express';
import { AuthService } from '../services/auth.service';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

export const login = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, password, totpCode } = req.body;
  const result = await AuthService.login(
    email,
    password,
    totpCode,
    req.ip,
    req.headers['user-agent']
  );
  res.json({ success: true, data: result });
});

export const refresh = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { refreshToken } = req.body;
  const tokens = await AuthService.refreshToken(refreshToken);
  res.json({ success: true, data: tokens });
});

export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
  await AuthService.logout(req.user!.id, req.body.refreshToken);
  res.json({ success: true, message: 'Logged out successfully' });
});

export const me = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { prisma } = await import('../config/database');
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      role: true,
      department: true,
      branch: true,
    },
  });
  const { passwordHash, twoFactorSecret, ...safeUser } = user!;
  res.json({
    success: true,
    data: {
      ...safeUser,
      permissions: req.user!.permissions,
    },
  });
});

export const setup2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await AuthService.setup2FA(req.user!.id);
  res.json({ success: true, data: result });
});

export const verify2FA = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { token } = req.body;
  const result = await AuthService.verify2FA(req.user!.id, token);
  res.json({ success: true, data: result });
});

export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  await AuthService.changePassword(req.user!.id, currentPassword, newPassword);
  res.json({ success: true, message: 'Password changed successfully' });
});
