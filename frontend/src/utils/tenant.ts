const PLATFORM_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin']);

/** Base app host without tenant subdomain, e.g. `erp.example.com` or `localhost:5173`. */
export function getAppBaseHost(hostname = window.location.hostname): string {
  const host = hostname.toLowerCase();
  if (host.endsWith('.localhost')) return 'localhost';
  const parts = host.split('.');
  if (parts.length >= 3 && !PLATFORM_SUBDOMAINS.has(parts[0])) {
    return parts.slice(1).join('.');
  }
  return host;
}

/** Resolve tenant slug from subdomain, e.g. `acme.localhost` → `acme`. */
export function resolveTenantSlugFromHost(hostname = window.location.hostname): string | null {
  const host = hostname.toLowerCase();

  if (host.endsWith('.localhost')) {
    const slug = host.slice(0, -'.localhost'.length);
    return slug && !PLATFORM_SUBDOMAINS.has(slug) ? slug : null;
  }

  const parts = host.split('.');
  if (parts.length >= 3) {
    const slug = parts[0];
    if (!PLATFORM_SUBDOMAINS.has(slug)) return slug;
  }

  return null;
}

export function resolveTenantSlugFromQuery(search: string): string | null {
  const slug = new URLSearchParams(search).get('tenant')?.trim().toLowerCase();
  return slug || null;
}

export function buildTenantLoginUrl(slug: string, baseHost = getAppBaseHost()): string {
  const protocol = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : '';
  if (baseHost === 'localhost') {
    return `${protocol}//${slug}.localhost${port}/login`;
  }
  return `${protocol}//${slug}.${baseHost}/login`;
}

export function buildTenantLoginPath(slug: string): string {
  return `/login?tenant=${encodeURIComponent(slug)}`;
}
