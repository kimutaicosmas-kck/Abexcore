import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { config } from '../config';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  const secret = config.encryption.key;
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return scryptSync(secret, 'apexcore-erp-salt', 32);
}

/** Encrypt sensitive fields at rest (e.g. TOTP secrets). */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload || !payload.includes(':')) return payload;
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) return payload;
  const decipher = createDecipheriv(ALGO, deriveKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** One-way hash for refresh tokens stored in DB. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
