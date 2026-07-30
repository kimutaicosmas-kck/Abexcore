import { API_BASE_URL } from '../config/api';

/** Resolve a stored upload path to a full URL for <img src> (auth via access_token query). */
export function resolveUploadUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  const normalized = path.startsWith('/') ? path : `/${path}`;
  let url: string;
  if (API_BASE_URL.startsWith('http')) {
    const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
    url = `${origin}${normalized}`;
  } else {
    url = normalized;
  }

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}
