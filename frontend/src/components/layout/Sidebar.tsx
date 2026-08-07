import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Users,
  Building2,
  Package,
  Warehouse,
  ShoppingCart,
  Factory,
  ClipboardCheck,
  Truck,
  DollarSign,
  UserCircle,
  Wrench,
  BarChart3,
  PanelLeftClose,
  PanelLeft,
  TrendingUp,
  Target,
  CalendarDays,
  CircleUser,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { accountNavLabel, isSidebarNavActive } from '../../config/routeAccess';
import { CompanyBrand } from '../brand/CompanyBrand';
import { PoweredBy } from '../brand/PoweredBy';

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  permissions?: string[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navigationGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ name: 'Dashboard', href: '/', icon: LayoutDashboard }],
  },
  {
    label: 'Master Data',
    items: [
      { name: 'Users', href: '/users', icon: Users, permission: 'users:read' },
      { name: 'CRM', href: '/customers', icon: Building2, permission: 'customers:read' },
      {
        name: 'Products',
        href: '/products',
        icon: Package,
        permissions: ['products:read', 'sales:read'],
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      { name: 'Inventory', href: '/inventory', icon: Warehouse, permission: 'inventory:read' },
      { name: 'Procurement', href: '/procurement', icon: ShoppingCart, permission: 'procurement:read' },
      { name: 'Production', href: '/production', icon: Factory, permission: 'production:read' },
      { name: 'Quality', href: '/quality', icon: ClipboardCheck, permission: 'quality:read' },
      { name: 'Sales', href: '/sales', icon: TrendingUp, permission: 'sales:read' },
      { name: 'Delivery', href: '/delivery', icon: Truck, permissions: ['delivery:read', 'delivery:create'] },
    ],
  },
  {
    label: 'Business',
    items: [
      { name: 'Finance', href: '/finance', icon: DollarSign, permission: 'finance:read' },
      { name: 'Sales Performance', href: '/sales-performance', icon: Target, permissions: ['reports:read', 'finance:read', 'settings:read'] },
      { name: 'HR', href: '/hr', icon: UserCircle, permission: 'hr:read' },
      { name: 'My Leave', href: '/my-leave', icon: CalendarDays },
      { name: 'Maintenance', href: '/maintenance', icon: Wrench, permission: 'maintenance:read' },
      { name: 'Reports', href: '/reports', icon: BarChart3, permission: 'reports:read' },
    ],
  },
  {
    label: 'System',
    items: [{ name: 'Account', href: '/account', icon: CircleUser }],
  },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, mobileOpen, onToggle }: SidebarProps) {
  const { hasPermission, isSalesOfficer, company } = useAuth();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const canReadSettings = hasPermission('settings:read');
  const systemNavName = accountNavLabel(canReadSettings);
  const systemNavIcon = canReadSettings ? Settings : CircleUser;

  // Keep the active item visible — do not reset the sidebar to the top on navigation.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [location.pathname]);

  const extraItems: NavItem[] = [
    ...(isSalesOfficer
      ? [{ name: 'My Sales', href: '/my-sales', icon: Target, permission: 'sales:read' as const }]
      : []),
  ];

  const navigationGroupsWithExtras: NavGroup[] = navigationGroups.map((group) => {
    if (group.label === 'System') {
      return {
        ...group,
        items: group.items.map((item) =>
          item.href === '/account'
            ? { ...item, name: systemNavName, icon: systemNavIcon }
            : item
        ),
      };
    }
    if (group.label !== 'Operations') return group;
    return {
      ...group,
      items: [...group.items, ...extraItems.filter((item) => !group.items.some((g) => g.href === item.href))],
    };
  });

  const visibleGroups = navigationGroupsWithExtras
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.permissions?.length) {
          return item.permissions.some((permission) => hasPermission(permission));
        }
        return !item.permission || hasPermission(item.permission);
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className={clsx(
        'sidebar-shell fixed inset-y-0 left-0 z-50 flex flex-col min-h-0 transition-[width,transform] duration-300 ease-out overflow-hidden',
        'border-r border-sidebar-border',
        collapsed ? 'sidebar-collapsed w-[4.5rem]' : 'w-64',
        // Off-canvas drawer must not steal touch/scroll when closed (mobile/PWA).
        mobileOpen
          ? 'translate-x-0'
          : '-translate-x-full lg:translate-x-0 max-lg:pointer-events-none'
      )}
    >
      <div className="sidebar-header flex min-h-14 shrink-0 items-center justify-between gap-1.5 px-2.5 py-2.5">
        {!collapsed ? (
          <>
            <CompanyBrand
              name={company?.name}
              logo={company?.logo}
              companySlug={company?.slug}
              inverted
              className="flex-1 min-w-0"
            />
            <button
              onClick={onToggle}
              className="sidebar-toggle-btn shrink-0 p-2 rounded-xl text-sidebar-muted hover:text-white transition-colors"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </>
        ) : (
          <div className="flex w-full flex-col items-center gap-2">
            <button
              onClick={onToggle}
              className="sidebar-toggle-btn p-1 rounded-xl transition-colors"
              aria-label="Expand sidebar"
              title={company?.name || 'Expand menu'}
            >
              <CompanyBrand
                name={company?.name}
                logo={company?.logo}
                companySlug={company?.slug}
                collapsed
                inverted
                showPlatformFallback={false}
              />
            </button>
            <button
              onClick={onToggle}
              className="sidebar-toggle-btn p-1.5 rounded-lg text-sidebar-muted hover:text-white transition-colors"
              aria-label="Expand sidebar"
              title="Expand menu"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <nav ref={navRef} className="sidebar-nav-scroll relative z-[1] flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2 px-2">
        {visibleGroups.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex > 0 ? 'mt-1.5' : undefined}>
            {groupIndex > 0 && collapsed && <div className="sidebar-group-divider" aria-hidden="true" />}
            {!collapsed && (
              <p className="px-2 mb-0.5 mt-1 first:mt-0 text-xs font-bold uppercase tracking-[0.12em] text-sidebar-heading">
                {group.label}
              </p>
            )}
            <div className={clsx('space-y-0.5', collapsed && 'flex flex-col items-center gap-0.5')}>
              {group.items.map((item) => {
                const active = isSidebarNavActive(location.pathname, item.href);
                return (
                <Link
                  key={item.href}
                  to={item.href}
                  title={collapsed ? item.name : undefined}
                  aria-label={item.name}
                  aria-current={active ? 'page' : undefined}
                  data-active={active ? 'true' : undefined}
                  className={clsx(
                    'sidebar-nav-item group flex items-center text-sm font-medium',
                    collapsed
                      ? 'justify-center w-10 h-10 p-0'
                      : 'gap-2.5 w-full px-2 py-1.5',
                    active
                      ? 'sidebar-nav-active font-semibold'
                      : 'sidebar-nav-idle'
                  )}
                >
                  <span
                    className={clsx(
                      'flex shrink-0 items-center justify-center transition-all duration-200',
                      collapsed
                        ? clsx(
                            'h-full w-full rounded-xl',
                            active ? 'sidebar-nav-icon-active' : 'sidebar-nav-icon-idle'
                          )
                        : clsx(
                            'rounded-lg h-8 w-8',
                            active
                              ? 'sidebar-nav-icon-active'
                              : 'sidebar-nav-icon-idle'
                          )
                    )}
                  >
                    <item.icon className={clsx(collapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4')} />
                  </span>
                  {!collapsed && (
                    <span className="sidebar-nav-label truncate leading-snug">{item.name}</span>
                  )}
                </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="sidebar-footer shrink-0 px-3 py-3">
          <PoweredBy centered className="text-[11px] leading-snug !text-slate-300" />
        </div>
      )}
    </aside>
  );
}
