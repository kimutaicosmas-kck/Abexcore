import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  TrendingUp,
  Target,
  Warehouse,
  DollarSign,
  Truck,
  Package,
  Building2,
  UserCircle,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { accountNavLabel, isSidebarNavActive } from '../../config/routeAccess';

type TabItem = {
  id: string;
  name: string;
  href: string;
  icon: LucideIcon;
};

const CANDIDATE_TABS: Array<{
  id: string;
  name: string;
  href: string;
  icon: LucideIcon;
  canShow: (ctx: { hasPermission: (p: string) => boolean; isSalesOfficer: boolean }) => boolean;
}> = [
  {
    id: 'sales',
    name: 'Sales',
    href: '/sales',
    icon: TrendingUp,
    canShow: ({ hasPermission, isSalesOfficer }) =>
      !isSalesOfficer &&
      (hasPermission('sales:read') || hasPermission('finance:read') || hasPermission('finance:create')),
  },
  {
    id: 'my-sales',
    name: 'My Sales',
    href: '/my-sales',
    icon: Target,
    canShow: ({ hasPermission, isSalesOfficer }) =>
      isSalesOfficer && (hasPermission('sales:read') || hasPermission('reports:read')),
  },
  {
    id: 'customers',
    name: 'CRM',
    href: '/customers',
    icon: Building2,
    canShow: ({ hasPermission }) => hasPermission('customers:read'),
  },
  {
    id: 'inventory',
    name: 'Stock',
    href: '/inventory',
    icon: Warehouse,
    canShow: ({ hasPermission }) => hasPermission('inventory:read'),
  },
  {
    id: 'products',
    name: 'Products',
    href: '/products',
    icon: Package,
    canShow: ({ hasPermission }) => hasPermission('products:read') || hasPermission('sales:read'),
  },
  {
    id: 'finance',
    name: 'Finance',
    href: '/finance',
    icon: DollarSign,
    canShow: ({ hasPermission }) => hasPermission('finance:read'),
  },
  {
    id: 'delivery',
    name: 'Delivery',
    href: '/delivery',
    icon: Truck,
    canShow: ({ hasPermission }) => hasPermission('delivery:read') || hasPermission('delivery:create'),
  },
];

function isAccountRoute(pathname: string) {
  const path = pathname.split('?')[0] ?? '';
  return path === '/account' || path.startsWith('/account/');
}

export function MobileBottomNav() {
  const { hasPermission, isSalesOfficer } = useAuth();
  const location = useLocation();
  const canReadSettings = hasPermission('settings:read');
  const accountLabel = accountNavLabel(canReadSettings);

  const middleTabs: TabItem[] = CANDIDATE_TABS.filter((tab) =>
    tab.canShow({ hasPermission, isSalesOfficer })
  )
    .slice(0, 3)
    .map((tab) => ({
      id: tab.id,
      name: tab.name,
      href: tab.href,
      icon: tab.icon,
    }));

  const tabs: TabItem[] = [
    { id: 'home', name: 'Home', href: '/', icon: LayoutDashboard },
    ...middleTabs,
    {
      id: 'account',
      name: accountLabel,
      href: '/account',
      icon: canReadSettings ? Settings : UserCircle,
    },
  ];
  return (
    <nav
      aria-label="Primary"
      className="mobile-tab-bar lg:hidden fixed bottom-0 inset-x-0 z-30"
    >
      <ul
        className={clsx(
          'grid h-[3.75rem]',
          tabs.length >= 5 ? 'grid-cols-5' : tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
        )}
      >
        {tabs.map((tab) => {
          const active =
            tab.id === 'account'
              ? isAccountRoute(location.pathname)
              : isSidebarNavActive(location.pathname, tab.href);
          const Icon = tab.icon;

          return (
            <li key={tab.id} className="min-w-0">
              <Link
                to={tab.href}
                className={clsx(
                  'mobile-tab-item',
                  active ? 'mobile-tab-item-active' : 'mobile-tab-item-idle'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <span className={clsx('mobile-tab-icon', active && 'mobile-tab-icon-active')}>
                  <Icon className="h-[1.35rem] w-[1.35rem]" strokeWidth={active ? 2.35 : 1.9} />
                </span>
                <span className="truncate max-w-full">{tab.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
