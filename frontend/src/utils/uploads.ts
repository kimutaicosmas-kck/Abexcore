import { API_BASE_URL } from '../config/api';

/** Company logos are publicly readable (login branding); other uploads need a token. */
function isPublicUploadPath(normalizedPath: string): boolean {
  return /^\/uploads\/companies\//i.test(normalizedPath);
}

/** Resolve a stored upload path to a full URL for <img src> (auth via access_token query when required). */
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

  if (isPublicUploadPath(normalized)) return url;

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}
