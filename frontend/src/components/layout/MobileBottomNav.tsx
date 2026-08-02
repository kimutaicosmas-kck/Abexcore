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
  Menu,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { isSidebarNavActive } from '../../config/routeAccess';

type TabItem = {
  id: string;
  name: string;
  href?: string;
  icon: LucideIcon;
  onClick?: () => void;
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
    canShow: ({ hasPermission }) => hasPermission('products:read'),
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

interface MobileBottomNavProps {
  onMoreClick: () => void;
}

export function MobileBottomNav({ onMoreClick }: MobileBottomNavProps) {
  const { hasPermission, isSalesOfficer } = useAuth();
  const location = useLocation();

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
    { id: 'more', name: 'More', icon: Menu, onClick: onMoreClick },
  ];

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_rgba(15,23,42,0.06)]"
    >
      <ul
        className={clsx(
          'grid h-16',
          tabs.length >= 5 ? 'grid-cols-5' : tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
        )}
      >
        {tabs.map((tab) => {
          const active = tab.href ? isSidebarNavActive(location.pathname, tab.href) : false;
          const Icon = tab.icon;
          const className = clsx(
            'flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors',
            active ? 'text-primary-600' : 'text-slate-500 active:text-slate-800'
          );

          if (tab.onClick || !tab.href) {
            return (
              <li key={tab.id} className="min-w-0">
                <button type="button" onClick={tab.onClick} className={className} aria-label={tab.name}>
                  <Icon className="h-5 w-5" />
                  <span className="truncate max-w-full">{tab.name}</span>
                </button>
              </li>
            );
          }

          return (
            <li key={tab.id} className="min-w-0">
              <Link to={tab.href} className={className} aria-current={active ? 'page' : undefined}>
                <Icon className={clsx('h-5 w-5', active && 'stroke-[2.25]')} />
                <span className="truncate max-w-full">{tab.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
