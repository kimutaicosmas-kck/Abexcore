import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../config/logger';
import { decryptSecret, encryptSecret } from '../utils/crypto';
import prisma from '../config/database';
import { getTenantId } from '../utils/tenant';

type SmtpRuntime = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  source: 'company' | 'env';
};

const transporterCache = new Map<string, nodemailer.Transporter>();

function buildFrom(fromName: string, fromEmail: string) {
  const name = fromName.trim();
  const email = fromEmail.trim();
  if (!email) return config.smtp.from;
  return name ? `${name} <${email}>` : email;
}

function createTransport(smtp: SmtpRuntime): nodemailer.Transporter {
  // Port 465 = implicit TLS. Port 587 = STARTTLS (secure must be false).
  const secure = smtp.port === 465 ? true : smtp.port === 587 ? false : !!smtp.secure;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure,
    requireTLS: smtp.port === 587,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
}

function formatSmtpError(error: unknown): string {
  const err = error as { code?: string; response?: string; message?: string; reason?: string; command?: string };
  const raw = `${err.response || ''} ${err.message || ''} ${err.reason || ''} ${err.code || ''}`;
  if (/535|BadCredentials|Username and Password not accepted/i.test(raw)) {
    return 'SMTP login rejected. Paste the 16-character Google App Password into Settings → Email (not your normal Gmail password), Save, then test again. Creating the App Password in Google alone is not enough.';
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|Greeting never received|Connection timeout/i.test(raw) || err.code === 'ETIMEDOUT') {
    return 'Could not reach the SMTP server (timeout). On Contabo/VPS, outbound ports 25/465/587 are often blocked — ask the host to open SMTP, or use an API email provider (Resend, SendGrid, Mailgun).';
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/i.test(raw) || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    return 'Cannot connect to the SMTP host. Check host/port, or ask Contabo to allow outbound SMTP.';
  }
  if (/wrong version number|ESOCKET|ECONNECTION/i.test(raw)) {
    return 'SMTP TLS/port mismatch. Use port 587 without SSL, or port 465 with SSL.';
  }
  if (/EAUTH/i.test(raw) || err.code === 'EAUTH') {
    return 'SMTP authentication failed. Check username and password.';
  }
  return err.message || 'Failed to send email. Check SMTP host, port, username, and password.';
}

function envSmtp(): SmtpRuntime | null {
  if (!config.smtp.user || !config.smtp.pass) return null;
  return {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    user: config.smtp.user,
    pass: decryptSecret(config.smtp.pass),
    from: config.smtp.from,
    source: 'env',
  };
}

/** Gmail App Passwords are often copied with spaces — strip them. */
function normalizeSmtpPassword(password: string): string {
  return password.replace(/\s+/g, '').trim();
}

async function companySmtp(companyId: string): Promise<SmtpRuntime | null> {
  const row = await prisma.emailConfig.findFirst({
    where: { companyId, isActive: true },
  });
  if (!row?.username || !row.password || !row.host) return null;
  let pass = row.password;
  try {
    pass = decryptSecret(row.password);
  } catch (err) {
    logger.error('Failed to decrypt SMTP password — re-save email settings', err);
    return null;
  }
  return {
    host: row.host,
    port: row.port || 587,
    secure: row.secure || row.port === 465,
    user: row.username.trim(),
    pass: normalizeSmtpPassword(pass),
    from: buildFrom(row.fromName, row.fromEmail),
    source: 'company',
  };
}

async function companyEmailConfigRow(companyId: string) {
  return prisma.emailConfig.findFirst({ where: { companyId } });
}

async function resolveSmtp(companyId?: string | null): Promise<SmtpRuntime | null> {
  const cid = companyId || getTenantId();
  if (cid) {
    const row = await companyEmailConfigRow(cid);
    if (row?.isActive) {
      const company = await companySmtp(cid);
      if (company) return company;
      logger.warn(
        `Company SMTP is active but could not be loaded for ${cid} — not using server env fallback`
      );
      return null;
    }
  }
  return envSmtp();
}

function cacheKey(smtp: SmtpRuntime, companyId?: string | null) {
  return `${smtp.source}:${companyId || 'env'}:${smtp.host}:${smtp.port}:${smtp.user}:${smtp.from}`;
}

export class EmailService {
  /** True when global env SMTP is set (health probe). Prefer company status for tenants. */
  static isConfigured(): boolean {
    return !!(config.smtp.user && config.smtp.pass);
  }

  static async isConfiguredForCompany(companyId?: string | null): Promise<boolean> {
    return !!(await resolveSmtp(companyId));
  }

  static async getCompanyEmailStatus(companyId: string) {
    const row = await companyEmailConfigRow(companyId);
    const companyReady = !!(row?.isActive && row.username && row.host);
    const envReady = this.isConfigured();
    const resolved = await resolveSmtp(companyId);
    return {
      configured: companyReady || envReady,
      source: companyReady ? ('company' as const) : envReady ? ('env' as const) : ('none' as const),
      effectiveSource: resolved?.source ?? ('none' as const),
      effectiveFrom: resolved?.from ?? null,
      effectiveUsername: resolved?.user ?? null,
      hasPassword: !!row,
      config: row
        ? {
            host: row.host,
            port: row.port,
            secure: row.secure,
            username: row.username,
            fromEmail: row.fromEmail,
            fromName: row.fromName,
            isActive: row.isActive,
            updatedAt: row.updatedAt,
          }
        : null,
      envFallback: envReady,
      usingEnvDespiteCompanyConfig:
        !!row?.isActive && companyReady && resolved?.source === 'env',
    };
  }

  static async send(
    to: string,
    subject: string,
    html: string,
    attachments?: { filename: string; content: Buffer; contentType?: string }[],
    companyId?: string | null
  ): Promise<boolean> {
    const smtp = await resolveSmtp(companyId);
    if (!smtp) {
      logger.warn(`Email skipped (SMTP not configured): ${subject} -> ${to}`);
      return false;
    }

    const key = cacheKey(smtp, companyId);
    let transport = transporterCache.get(key);
    if (!transport) {
      transport = createTransport(smtp);
      transporterCache.set(key, transport);
    }

    try {
      await transport.sendMail({
        from: smtp.from,
        to,
        subject,
        html,
        attachments: attachments?.map((file) => ({
          filename: file.filename,
          content: file.content,
          contentType: file.contentType,
        })),
      });
      logger.info(`Email sent (${smtp.source}): ${subject} -> ${to}`);
      return true;
    } catch (error) {
      transporterCache.delete(key);
      logger.error('Email send failed', error);
      return false;
    }
  }

  /** Like send(), but throws a user-facing SMTP error (for Settings test). */
  static async sendOrThrow(
    to: string,
    subject: string,
    html: string,
    companyId?: string | null
  ): Promise<void> {
    const smtp = await resolveSmtp(companyId);
    if (!smtp) {
      throw new Error('SMTP is not configured. Save email settings first.');
    }

    const key = cacheKey(smtp, companyId);
    let transport = transporterCache.get(key);
    if (!transport) {
      transport = createTransport(smtp);
      transporterCache.set(key, transport);
    }

    try {
      await transport.sendMail({ from: smtp.from, to, subject, html });
      logger.info(`Email sent (${smtp.source}): ${subject} -> ${to}`);
    } catch (error) {
      transporterCache.delete(key);
      logger.error('Email send failed', error);
      throw new Error(formatSmtpError(error));
    }
  }

  /** Persist tenant SMTP settings with password encrypted at rest. */
  static async upsertCompanyEmailConfig(
    companyId: string,
    data: {
      host: string;
      port: number;
      secure?: boolean;
      username: string;
      password?: string;
      fromEmail: string;
      fromName: string;
      isActive?: boolean;
    }
  ) {
    const existing = await prisma.emailConfig.findFirst({ where: { companyId } });
    const password = data.password ? normalizeSmtpPassword(data.password) : '';
    if (!existing && !password) {
      throw new Error('SMTP password is required');
    }
    if (
      existing &&
      data.username.trim().toLowerCase() !== existing.username.trim().toLowerCase() &&
      !password
    ) {
      throw new Error('Enter the App Password again when changing SMTP username.');
    }

    const fromEmail = data.fromEmail.trim();
    const username = data.username.trim();

    const encryptedPassword = password ? encryptSecret(password) : existing!.password;
    const payload = {
      host: data.host.trim(),
      port: data.port,
      secure: data.secure ?? data.port === 465,
      username,
      password: encryptedPassword,
      fromEmail,
      fromName: data.fromName.trim(),
      isActive: data.isActive ?? true,
    };

    for (const key of [...transporterCache.keys()]) {
      transporterCache.delete(key);
    }

    if (existing) {
      return prisma.emailConfig.update({ where: { id: existing.id }, data: payload });
    }
    return prisma.emailConfig.create({ data: { companyId, ...payload } });
  }

  static async sendTestEmail(companyId: string, to: string) {
    const smtp = await resolveSmtp(companyId);
    if (!smtp) {
      throw new Error('SMTP is not configured. Save email settings first.');
    }
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#2563eb;color:white;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">AbexCore ERP</h2>
        </div>
        <div style="border:1px solid #e5e7eb;padding:24px;border-radius:0 0 8px 8px">
          <h3 style="margin-top:0">Test email successful</h3>
          <p style="color:#374151">
            SMTP is configured correctly. Notification emails (low stock, delivery, leave, invites, etc.)
            will be sent to users when events occur.
          </p>
          <p style="color:#64748b;font-size:13px">Sent from: <strong>${smtp.from}</strong> (${smtp.source === 'company' ? 'company settings' : 'server .env'})</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px">Designed by AbexCore Technologies</p>
        </div>
      </div>`;
    await this.sendOrThrow(to, '[AbexCore ERP] Test email', html, companyId);
    return true;
  }

  static async sendNotificationEmail(
    to: string,
    title: string,
    message: string,
    link?: string,
    companyId?: string | null
  ) {
    const cid = companyId || getTenantId();
    const baseUrl = (config.frontendUrl || '').replace(/\/$/, '');
    const href = link ? `${baseUrl}${link.startsWith('/') ? link : `/${link}`}` : '';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#2563eb;color:white;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">AbexCore ERP</h2>
        </div>
        <div style="border:1px solid #e5e7eb;padding:24px;border-radius:0 0 8px 8px">
          <h3 style="margin-top:0">${title}</h3>
          <p style="color:#374151">${message}</p>
          ${href ? `<p><a href="${href}" style="color:#2563eb">View in ERP</a></p>` : ''}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px">Designed by AbexCore Technologies</p>
        </div>
      </div>`;
    return this.send(to, `[AbexCore ERP] ${title}`, html, undefined, cid);
  }

  static async sendInviteEmail(input: {
    to: string;
    firstName: string;
    companyName: string;
    companySlug: string;
    temporaryPassword: string;
    companyId: string;
  }): Promise<boolean> {
    const baseUrl = (config.frontendUrl || '').replace(/\/$/, '');
    const loginUrl = baseUrl ? `${baseUrl}/login` : '/login';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#2563eb;color:white;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">${input.companyName}</h2>
          <p style="margin:8px 0 0;opacity:0.9;font-size:14px">AbexCore ERP workspace invite</p>
        </div>
        <div style="border:1px solid #e5e7eb;padding:24px;border-radius:0 0 8px 8px">
          <p style="color:#374151">Hi ${input.firstName},</p>
          <p style="color:#374151">
            Your account for <strong>${input.companyName}</strong> is ready. Use the details below to sign in.
            You will be asked to change your password on first login.
          </p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b;width:140px">Sign-in URL</td><td style="padding:8px 0"><a href="${loginUrl}" style="color:#2563eb">${loginUrl}</a></td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Company code</td><td style="padding:8px 0;font-weight:600">${input.companySlug}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Email</td><td style="padding:8px 0;font-weight:600">${input.to}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Temporary password</td><td style="padding:8px 0;font-family:monospace;font-weight:600">${input.temporaryPassword}</td></tr>
          </table>
          <p style="color:#64748b;font-size:13px">If you did not expect this invite, contact your company administrator.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px">Designed by AbexCore Technologies</p>
        </div>
      </div>`;
    return this.send(
      input.to,
      `[AbexCore ERP] Welcome to ${input.companyName}`,
      html,
      undefined,
      input.companyId
    );
  }
}
