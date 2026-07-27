import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../config/logger';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter && config.smtp.user && config.smtp.pass) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

export class EmailService {
  static isConfigured(): boolean {
    return !!(config.smtp.user && config.smtp.pass);
  }

  static async send(to: string, subject: string, html: string): Promise<boolean> {
    const transport = getTransporter();
    if (!transport) {
      logger.debug(`Email skipped (SMTP not configured): ${subject} -> ${to}`);
      return false;
    }

    try {
      await transport.sendMail({
        from: config.smtp.from,
        to,
        subject,
        html,
      });
      return true;
    } catch (error) {
      logger.error('Email send failed', error);
      return false;
    }
  }

  static async sendNotificationEmail(
    to: string,
    title: string,
    message: string,
    link?: string
  ) {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#2563eb;color:white;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">ApexCore ERP</h2>
        </div>
        <div style="border:1px solid #e5e7eb;padding:24px;border-radius:0 0 8px 8px">
          <h3 style="margin-top:0">${title}</h3>
          <p style="color:#374151">${message}</p>
          ${link ? `<p><a href="${config.frontendUrl}${link}" style="color:#2563eb">View in ERP</a></p>` : ''}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px">Designed by ApexCore Technologies</p>
        </div>
      </div>`;
    return this.send(to, `[ApexCore ERP] ${title}`, html);
  }
}
