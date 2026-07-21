import { NavLink } from 'react-router-dom';
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
  Settings,
  PanelLeftClose,
  PanelLeft,
  TrendingUp,
  Target,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { ApexCoreLogo } from '../brand/ApexCoreLogo';
import { PoweredBy } from '../brand/PoweredBy';
import { APP_NAME } from '../../constants/brand';

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
      { name: 'Products', href: '/products', icon: Package, permission: 'products:read' },
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
      { name: 'Delivery', href: '/delivery', icon: Truck, permission: 'delivery:read' },
    ],
  },
  {
    label: 'Business',
    items: [
      { name: 'Finance', href: '/finance', icon: DollarSign, permission: 'finance:read' },
      { name: 'Sales Performance', href: '/sales-performance', icon: Target, permissions: ['reports:read', 'finance:read', 'settings:read'] },
      { name: 'HR', href: '/hr', icon: UserCircle, permission: 'hr:read' },
      { name: 'Maintenance', href: '/maintenance', icon: Wrench, permission: 'maintenance:read' },
      { name: 'Reports', href: '/reports', icon: BarChart3, permission: 'reports:read' },
    ],
  },
  {
    label: 'System',
    items: [{ name: 'Settings', href: '/settings', icon: Settings, permission: 'settings:read' }],
  },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, mobileOpen, onToggle }: SidebarProps) {
  const { hasPermission, isSalesOfficer } = useAuth();

  const extraItems: NavItem[] = [
    ...(isSalesOfficer
      ? [{ name: 'My Sales', href: '/my-sales', icon: Target, permission: 'sales:read' as const }]
      : []),
  ];

  const navigationGroupsWithExtras: NavGroup[] = navigationGroups.map((group) => {
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
        'fixed inset-y-0 left-0 z-50 flex flex-col bg-white border-r border-slate-200 shadow-[4px_0_24px_rgba(15,23,42,0.08)] transition-transform duration-300',
        collapsed ? 'w-16' : 'w-60',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3">
        {!collapsed ? (
          <>
            <ApexCoreLogo variant="sidebar" className="flex-1" />
            <button
              onClick={onToggle}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white transition-colors"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={onToggle}
            className="mx-auto p-1 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Expand sidebar"
            title={APP_NAME}
          >
            <ApexCoreLogo variant="mark" size="sm" inverted={false} />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="px-2.5 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end={item.href === '/'}
                  title={collapsed ? item.name : undefined}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                      isActive
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={clsx(
                          'h-4 w-4 shrink-0',
                          isActive ? 'text-white' : 'text-slate-500'
                        )}
                      />
                      {!collapsed && <span className="truncate">{item.name}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 border-t border-slate-200 px-3 py-2.5 bg-slate-50">
          <PoweredBy centered />
        </div>
      )}
    </aside>
  );
}
