import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveUploadUrl } from './uploads';

describe('resolveUploadUrl', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('returns null for empty path', () => {
    expect(resolveUploadUrl(null)).toBeNull();
    expect(resolveUploadUrl(undefined)).toBeNull();
    expect(resolveUploadUrl('')).toBeNull();
  });

  it('passes through absolute URLs', () => {
    expect(resolveUploadUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });

  it('appends access_token from localStorage for relative uploads', () => {
    localStorage.setItem('accessToken', 'tok-123');
    const url = resolveUploadUrl('/uploads/companies/logo.png');
    expect(url).toContain('/uploads/companies/logo.png');
    expect(url).toContain('access_token=tok-123');
  });
});
