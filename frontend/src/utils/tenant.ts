const PLATFORM_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin']);

/** Multi-label public suffixes where the registrable domain has 3+ labels (e.g. abexcore.co.ke). */
const MULTI_PART_PUBLIC_SUFFIXES = [
  'co.ke',
  'or.ke',
  'ne.ke',
  'go.ke',
  'ac.ke',
  'me.ke',
  'sc.ke',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.za',
  'org.za',
].sort((a, b) => b.length - a.length);

/** IPv4 / IPv6 hosts must never be treated as tenant.base.tld (e.g. 127.0.0.1 → "127"). */
function isIpHostname(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(':')) return true; // IPv6 or [ipv6]
  return false;
}

function splitRegistrable(hostname: string): { tenant: string | null; baseHost: string } {
  const host = hostname.toLowerCase();
  if (isIpHostname(host)) return { tenant: null, baseHost: host };

  for (const suffix of MULTI_PART_PUBLIC_SUFFIXES) {
    if (host === suffix) return { tenant: null, baseHost: host };
    if (!host.endsWith(`.${suffix}`)) continue;

    const withoutSuffix = host.slice(0, -(suffix.length + 1));
    const labels = withoutSuffix.split('.').filter(Boolean);
    if (labels.length === 0) return { tenant: null, baseHost: host };
    if (labels.length === 1) {
      // Apex: abexcore.co.ke
      return { tenant: null, baseHost: host };
    }

    const candidate = labels[0];
    const baseHost = `${labels.slice(1).join('.')}.${suffix}`;
    if (PLATFORM_SUBDOMAINS.has(candidate)) {
      return { tenant: null, baseHost };
    }
    // Tenant subdomain: owner.abexcore.co.ke
    return { tenant: candidate, baseHost };
  }

  const parts = host.split('.');
  if (parts.length >= 3) {
    const candidate = parts[0];
    const baseHost = parts.slice(1).join('.');
    if (!PLATFORM_SUBDOMAINS.has(candidate)) {
      return { tenant: candidate, baseHost };
    }
    return { tenant: null, baseHost };
  }

  return { tenant: null, baseHost: host };
}

/** Base app host without tenant subdomain, e.g. `abexcore.co.ke` or `localhost`. */
export function getAppBaseHost(hostname = window.location.hostname): string {
  const host = hostname.toLowerCase();
  if (host.endsWith('.localhost')) return 'localhost';
  return splitRegistrable(host).baseHost;
}

/** Resolve tenant slug from subdomain, e.g. `acme.localhost` → `acme`. */
export function resolveTenantSlugFromHost(hostname = window.location.hostname): string | null {
  const host = hostname.toLowerCase();
  if (isIpHostname(host) || host === 'localhost') return null;

  if (host.endsWith('.localhost')) {
    const slug = host.slice(0, -'.localhost'.length);
    return slug && !PLATFORM_SUBDOMAINS.has(slug) ? slug : null;
  }

  return splitRegistrable(host).tenant;
}

export function resolveTenantSlugFromQuery(search: string): string | null {
  const slug = new URLSearchParams(search).get('tenant')?.trim().toLowerCase();
  return slug || null;
}

/** True when running as an installed PWA / Add to Home Screen app. */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
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
