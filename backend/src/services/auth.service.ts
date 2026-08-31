import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { config } from '../config';
import { sanitizeCompanyBrand } from '../utils/platform';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { encryptSecret, decryptSecret, hashToken } from '../utils/crypto';
import { auditAuthFailure, auditAuthSuccess } from '../utils/audit';
import { resolveUserPermissionStrings } from '../utils/userPermissions';

const SALT_ROUNDS = 12;

function readTwoFactorSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return stored;
  }
}

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

  static generateTokens(userId: string, email: string, roleId: string, companyId: string) {
    const accessToken = jwt.sign({ userId, email, roleId, companyId }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as SignOptions);
    const refreshToken = jwt.sign({ userId, jti: randomUUID(), companyId }, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
    } as SignOptions);
    return { accessToken, refreshToken };
  }

  static async login(
    email: string,
    password: string,
    companySlug?: string,
    totpCode?: string,
    ipAddress?: string,
    userAgent?: string | string[]
  ) {
    const normalizedEmail = email.toLowerCase();
    let companyId: string | undefined;

    if (companySlug?.trim()) {
      // Select only id — a full-row read fails if prod DB is missing a newer companies.* column.
      const company = await prisma.company.findFirst({
        where: { slug: companySlug.trim().toLowerCase(), isActive: true },
        select: { id: true },
      });
      if (!company) throw new AppError('Company not found or inactive', 404);
      companyId = company.id;
    }

    const agent =
      typeof userAgent === 'string' ? userAgent : Array.isArray(userAgent) ? userAgent[0] : undefined;

    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        ...(companyId ? { companyId } : {}),
      },
      select: {
        id: true,
        companyId: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        roleId: true,
        departmentId: true,
        branchId: true,
        status: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        mustChangePassword: true,
        allowedModules: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        role: {
          select: {
            id: true,
            name: true,
            description: true,
            permissions: { select: { permission: { select: { module: true, action: true } } } },
          },
        },
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, code: true } },
        company: {
          select: {
            id: true,
            slug: true,
            name: true,
            logo: true,
            vatRate: true,
            currency: true,
            isActive: true,
            welcomeMessage: true,
            enabledModules: true,
            brandPrimary: true,
            brandAccent: true,
            docPrimaryColor: true,
          },
        },
      },
    });

    const loginFail = async (reason: string) => {
      if (user) {
        try {
          await prisma.loginHistory.create({
            data: { userId: user.id, ipAddress, userAgent: agent, success: false },
          });
        } catch {
          // Do not turn auth failures into 500s if history write fails.
        }
      }
      await auditAuthFailure({
        companyId: user?.companyId || companyId,
        userId: user?.id,
        email: normalizedEmail,
        reason,
        ipAddress,
        userAgent: agent,
      });
      throw new AppError('Invalid email or password', 401);
    };

    if (!user || user.deletedAt || user.status !== 'ACTIVE') await loginFail('invalid_credentials');
    if (!user!.company?.isActive) throw new AppError('Company account is inactive', 403);

    let valid = false;
    try {
      valid = await bcrypt.compare(password, user!.passwordHash || '');
    } catch {
      await loginFail('invalid_password_hash');
    }
    if (!valid) await loginFail('invalid_password');

    if (user!.twoFactorEnabled) {
      if (!totpCode) {
        throw new AppError('Two-factor authentication code required', 403, '2FA_REQUIRED');
      }
      const secret = readTwoFactorSecret(user!.twoFactorSecret);
      const verified = speakeasy.totp.verify({
        secret: secret!,
        encoding: 'base32',
        token: totpCode,
        window: 2,
      });
      if (!verified) {
        await auditAuthFailure({
          companyId: user!.companyId,
          userId: user!.id,
          email: normalizedEmail,
          reason: 'invalid_2fa',
          ipAddress,
          userAgent: agent,
        });
        throw new AppError('Invalid 2FA code', 401);
      }
    }

    const tokens = this.generateTokens(user!.id, user!.email, user!.roleId, user!.companyId);

    await prisma.refreshToken.create({
      data: {
        userId: user!.id,
        token: hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.user.update({
      where: { id: user!.id },
      data: { lastLoginAt: new Date() },
    });

    try {
      await prisma.loginHistory.create({
        data: { userId: user!.id, ipAddress, userAgent: agent, success: true },
      });
    } catch {
      // Non-fatal — login already succeeded.
    }

    await auditAuthSuccess({
      companyId: user!.companyId,
      userId: user!.id,
      ipAddress,
    });

    const { passwordHash: _pw, twoFactorSecret: _tfa, ...safeUser } = user!;
    const company = user!.company;
    const permissions = await resolveUserPermissionStrings(user!);

    let companyPayload: Record<string, unknown> = {
      name: 'Company',
      vatRate: 16,
      currency: 'KES',
      welcomeMessage: null,
    };
    if (company) {
      const { ensureCompanyBrandColors } = await import('../utils/ensureCompanyBrand');
      const brand = await ensureCompanyBrandColors({
        id: company.id,
        slug: company.slug,
        brandPrimary: company.brandPrimary,
        brandAccent: company.brandAccent,
        docPrimaryColor: company.docPrimaryColor,
      });
      companyPayload = sanitizeCompanyBrand({
        id: company.id,
        slug: company.slug,
        name: company.name,
        logo: company.logo,
        vatRate: Number(company.vatRate),
        currency: company.currency,
        welcomeMessage: company.welcomeMessage,
        enabledModules: company.enabledModules,
        brandPrimary: brand.brandPrimary,
        brandAccent: brand.brandAccent,
        docPrimaryColor: brand.docPrimaryColor,
      });
    }

    return {
      user: {
        ...safeUser,
        permissions,
      },
      mustChangePassword: user!.mustChangePassword,
      company: companyPayload,
      ...tokens,
    };
  }

  static async refreshToken(token: string) {
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(token, config.jwt.refreshSecret) as { userId: string };
    } catch {
      throw new AppError('Invalid refresh token', 401);
    }
    const tokenHash = hashToken(token);

    const stored = await prisma.refreshToken.findFirst({
      where: { token: tokenHash, userId: decoded.userId, expiresAt: { gt: new Date() } },
    });

    if (!stored) throw new AppError('Invalid refresh token', 401);

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('User inactive', 401);

    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const tokens = this.generateTokens(user.id, user.email, user.roleId, user.companyId);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return tokens;
  }

  static async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { userId, token: hashToken(refreshToken) },
      });
    } else {
      await prisma.refreshToken.deleteMany({ where: { userId } });
    }
  }

  static async setup2FA(userId: string) {
    const secret = speakeasy.generateSecret({ name: 'AbexCore ERP' });
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptSecret(secret.base32!) },
    });
    const qrCode = await qrcode.toDataURL(secret.otpauth_url!);
    return { secret: secret.base32, qrCode };
  }

  static async verify2FA(userId: string, token: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const secret = readTwoFactorSecret(user?.twoFactorSecret);
    if (!secret) throw new AppError('2FA not configured', 400);

    const verified = speakeasy.totp.verify({
      secret,
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
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
    });

    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  static hashPassword(password: string) {
    this.validatePassword(password);
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /** Migrate legacy plaintext refresh tokens to hashed form (startup maintenance). */
  static async migrateRefreshTokenHashes() {
    const tokens = await prisma.refreshToken.findMany({ take: 500 });
    for (const row of tokens) {
      if (row.token.length === 64 && /^[a-f0-9]+$/.test(row.token)) continue;
      const hashed = hashToken(row.token);
      await prisma.refreshToken.update({
        where: { id: row.id },
        data: { token: hashed },
      });
    }
  }
}
