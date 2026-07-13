import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { config } from '../config';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

const SALT_ROUNDS = 12;

export class AuthService {
  static validatePassword(password: string): void {
    const { minLength, requireUppercase, requireLowercase, requireNumber } =
      config.passwordPolicy;

    if (password.length < minLength) {
      throw new AppError(`Password must be at least ${minLength} characters`, 400);
    }
    if (requireUppercase && !/[A-Z]/.test(password)) {
      throw new AppError('Password must contain an uppercase letter', 400);
    }
    if (requireLowercase && !/[a-z]/.test(password)) {
      throw new AppError('Password must contain a lowercase letter', 400);
    }
    if (requireNumber && !/[0-9]/.test(password)) {
      throw new AppError('Password must contain a number', 400);
    }
  }

  static generateTokens(userId: string, email: string, roleId: string) {
    const accessToken = jwt.sign({ userId, email, roleId }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as SignOptions);
    const refreshToken = jwt.sign({ userId }, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
    } as SignOptions);
    return { accessToken, refreshToken };
  }

  static async login(email: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
        department: true,
        branch: true,
      },
    });

    const loginFail = async () => {
      if (user) {
        await prisma.loginHistory.create({
          data: { userId: user.id, ipAddress, userAgent, success: false },
        });
      }
      throw new AppError('Invalid email or password', 401);
    };

    if (!user || user.deletedAt || user.status !== 'ACTIVE') await loginFail();

    const valid = await bcrypt.compare(password, user!.passwordHash);
    if (!valid) await loginFail();

    const tokens = this.generateTokens(user!.id, user!.email, user!.roleId);

    await prisma.refreshToken.create({
      data: {
        userId: user!.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.user.update({
      where: { id: user!.id },
      data: { lastLoginAt: new Date() },
    });

    await prisma.loginHistory.create({
      data: { userId: user!.id, ipAddress, userAgent, success: true },
    });

    const { passwordHash, twoFactorSecret, ...safeUser } = user!;

    return {
      user: {
        ...safeUser,
        permissions: user!.role.permissions.map(
          (rp) => `${rp.permission.module}:${rp.permission.action}`
        ),
      },
      ...tokens,
    };
  }

  static async refreshToken(token: string) {
    const decoded = jwt.verify(token, config.jwt.refreshSecret) as { userId: string };

    const stored = await prisma.refreshToken.findFirst({
      where: { token, userId: decoded.userId, expiresAt: { gt: new Date() } },
    });

    if (!stored) throw new AppError('Invalid refresh token', 401);

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('User inactive', 401);

    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const tokens = this.generateTokens(user.id, user.email, user.roleId);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return tokens;
  }

  static async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { userId, token: refreshToken } });
    } else {
      await prisma.refreshToken.deleteMany({ where: { userId } });
    }
  }

  static async setup2FA(userId: string) {
    const secret = speakeasy.generateSecret({ name: 'Filter ERP' });
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret.base32 },
    });
    const qrCode = await qrcode.toDataURL(secret.otpauth_url!);
    return { secret: secret.base32, qrCode };
  }

  static async verify2FA(userId: string, token: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret) throw new AppError('2FA not configured', 400);

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 2,
    });

    if (!verified) throw new AppError('Invalid 2FA token', 401);

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    return { enabled: true };
  }

  static async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Current password is incorrect', 400);

    this.validatePassword(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  static hashPassword(password: string) {
    this.validatePassword(password);
    return bcrypt.hash(password, SALT_ROUNDS);
  }
}
