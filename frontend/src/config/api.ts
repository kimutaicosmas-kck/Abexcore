/** API base URL — set VITE_API_URL at build time for split hosting (e.g. Railway/Render). */
export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1';

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE_URL.endsWith('/api/v1')) {
    return `${API_BASE_URL}${normalized.replace(/^\/api\/v1/, '')}`;
  }
  return `${API_BASE_URL}${normalized}`;
}
