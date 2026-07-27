import { API_BASE_URL } from '../config/api';

/** Resolve a stored upload path to a full URL for <img src>. */
export function resolveUploadUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE_URL.startsWith('http')) {
    const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
    return `${origin}${normalized}`;
  }
  return normalized;
}
