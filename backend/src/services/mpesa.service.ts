import { config } from '../config';
import { AppError } from '../middleware/errorHandler';
import { resilientFetch } from '../utils/resilientFetch';

/**
 * Safaricom Daraja M-Pesa STK Push integration.
 * Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL in production.
 * Use MPESA_ENV=stub for local dev without Daraja credentials.
 */
export class MpesaService {
  static isConfigured(): boolean {
    if (process.env.MPESA_ENV === 'stub') return true;
    return !!(
      process.env.MPESA_CONSUMER_KEY &&
      process.env.MPESA_CONSUMER_SECRET &&
      process.env.MPESA_SHORTCODE &&
      process.env.MPESA_PASSKEY
    );
  }

  static isLive(): boolean {
    return (
      this.isConfigured() &&
      process.env.MPESA_ENV !== 'stub' &&
      !!process.env.MPESA_CONSUMER_KEY
    );
  }

  private static getBaseUrl(): string {
    const sandbox = process.env.MPESA_ENV !== 'production';
    return sandbox
      ? 'https://sandbox.safaricom.co.ke'
      : 'https://api.safaricom.co.ke';
  }

  private static async getAccessToken(): Promise<string> {
    const key = process.env.MPESA_CONSUMER_KEY!;
    const secret = process.env.MPESA_CONSUMER_SECRET!;
    const auth = Buffer.from(`${key}:${secret}`).toString('base64');

    const res = await resilientFetch(`${this.getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
    }, { service: 'mpesa', timeoutMs: 10_000, retries: 2 });

    if (!res.ok) {
      throw new AppError('Failed to obtain M-Pesa OAuth token', 502);
    }

    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new AppError('M-Pesa OAuth token missing', 502);
    return data.access_token;
  }

  static async initiateStkPush(opts: {
    phone: string;
    amount: number;
    accountReference: string;
    description: string;
  }): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
    if (!this.isConfigured()) {
      throw new AppError(
        'M-Pesa is not configured. Set MPESA_* env vars or MPESA_ENV=stub for development.',
        503
      );
    }

    if (!this.isLive()) {
      return {
        checkoutRequestId: `CHK-${Date.now()}`,
        merchantRequestId: `MR-${Date.now()}`,
      };
    }

    const shortcode = process.env.MPESA_SHORTCODE!;
    const passkey = process.env.MPESA_PASSKEY!;
    const callbackUrl =
      process.env.MPESA_CALLBACK_URL ||
      `http://localhost:${config.port}/api/v1/finance/mpesa/callback`;
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const token = await this.getAccessToken();

    const res = await resilientFetch(`${this.getBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.ceil(opts.amount),
        PartyA: opts.phone,
        PartyB: shortcode,
        PhoneNumber: opts.phone,
        CallBackURL: callbackUrl,
        AccountReference: opts.accountReference.slice(0, 12),
        TransactionDesc: opts.description.slice(0, 13),
      }),
    }, { service: 'mpesa', timeoutMs: 15_000, retries: 1 });

    const data = (await res.json()) as {
      CheckoutRequestID?: string;
      MerchantRequestID?: string;
      errorMessage?: string;
    };

    if (!res.ok || !data.CheckoutRequestID) {
      throw new AppError(data.errorMessage || 'M-Pesa STK push failed', 502);
    }

    return {
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID || `MR-${Date.now()}`,
    };
  }

  static normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('254')) return digits;
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    if (digits.length === 9) return `254${digits}`;
    return digits;
  }
}
