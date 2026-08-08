import { config } from '../config';

function originFromUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return raw.trim().replace(/\/$/, '') || null;
  }
}

const STATIC_ALLOWED = [
  config.frontendUrl,
  originFromUrl(process.env.PUBLIC_URL),
  originFromUrl(process.env.FRONTEND_URL),
  'https://abexcore.co.ke',
  'https://www.abexcore.co.ke',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
].filter((v): v is string => Boolean(v));

const DEV_LAN_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

const DEV_TUNNEL_ORIGIN =
  /^https?:\/\/[\w-]+\.(trycloudflare\.com|ngrok-free\.app|ngrok\.io|loca\.lt)(:\d+)?$/;

function extraOrigins(): string[] {
  return (process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (STATIC_ALLOWED.includes(origin)) return true;
  if (extraOrigins().includes(origin)) return true;

  if (config.nodeEnv !== 'production') {
    if (DEV_LAN_ORIGIN.test(origin) || DEV_TUNNEL_ORIGIN.test(origin)) return true;
  }

  return false;
}
