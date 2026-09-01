import { afterEach, describe, expect, it } from 'vitest';
import { resolveUploadUrl } from './uploads';

describe('resolveUploadUrl', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns null for empty path', () => {
    expect(resolveUploadUrl(null)).toBeNull();
    expect(resolveUploadUrl(undefined)).toBeNull();
    expect(resolveUploadUrl('')).toBeNull();
  });

  it('passes through absolute URLs', () => {
    expect(resolveUploadUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });

  it('keeps company logos public (no access_token) for login branding', () => {
    localStorage.setItem('accessToken', 'tok-123');
    const url = resolveUploadUrl('/uploads/companies/logo.png');
    expect(url).toContain('/uploads/companies/logo.png');
    expect(url).not.toContain('access_token=');
  });

  it('appends access_token for private uploads when logged in', () => {
    localStorage.setItem('accessToken', 'tok-123');
    const url = resolveUploadUrl('/uploads/products/item.webp');
    expect(url).toContain('/uploads/products/item.webp');
    expect(url).toContain('access_token=tok-123');
  });
});
