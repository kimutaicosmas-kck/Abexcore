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
  if (!pathname || pathname === '/') return '/';
  const segment = pathname.split('/').filter(Boolean)[0];
  return `/${segment}`;
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
