export const ROUTE_PERMISSIONS: Record<string, string | string[] | undefined> = {
  '/': undefined,
  '/users': 'users:read',
  '/customers': 'customers:read',
  '/products': 'products:read',
  '/inventory': 'inventory:read',
  '/procurement': 'procurement:read',
  '/production': 'production:read',
  '/quality': 'quality:read',
  '/sales': ['sales:read', 'finance:read', 'finance:create'],
  '/my-sales': ['sales:read', 'reports:read', 'finance:read'],
  '/sales-performance': ['reports:read', 'finance:read', 'settings:read'],
  '/delivery': 'delivery:read',
  '/finance': 'finance:read',
  '/hr': 'hr:read',
  '/maintenance': 'maintenance:read',
  '/reports': 'reports:read',
  '/settings': 'settings:read',
};

export function normalizeRoutePath(pathname: string): string {
  const path = pathname.split('?')[0]?.split('#')[0] ?? '/';
  if (!path || path === '/') return '/';
  const segment = path.split('/').filter(Boolean)[0];
  return segment ? `/${segment}` : '/';
}

/** Match sidebar item to current page — exact segment, avoids /sales matching /sales-performance. */
export function isSidebarNavActive(pathname: string, href: string): boolean {
  const current = normalizeRoutePath(pathname);
  if (href === '/') return current === '/';
  return current === href;
}

export function canAccessRoute(
  pathname: string,
  hasPermission: (permission: string) => boolean
): boolean {
  const key = normalizeRoutePath(pathname);
  const permission = ROUTE_PERMISSIONS[key];
  if (permission === undefined && key in ROUTE_PERMISSIONS) return true;
  if (!permission) return false;
  if (Array.isArray(permission)) {
    return permission.some((entry) => hasPermission(entry));
  }
  return hasPermission(permission);
}
