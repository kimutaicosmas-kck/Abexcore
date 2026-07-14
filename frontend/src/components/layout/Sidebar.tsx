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
  ChevronLeft,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { APP_NAME, APP_VERSION, DESIGNER } from '../../constants/brand';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Users', href: '/users', icon: Users, permission: 'users:read' },
  { name: 'CRM', href: '/customers', icon: Building2, permission: 'customers:read' },
  { name: 'Products', href: '/products', icon: Package, permission: 'products:read' },
  { name: 'Inventory', href: '/inventory', icon: Warehouse, permission: 'inventory:read' },
  { name: 'Procurement', href: '/procurement', icon: ShoppingCart, permission: 'procurement:read' },
  { name: 'Production', href: '/production', icon: Factory, permission: 'production:read' },
  { name: 'Quality', href: '/quality', icon: ClipboardCheck, permission: 'quality:read' },
  { name: 'Sales', href: '/sales', icon: ShoppingCart, permission: 'sales:read' },
  { name: 'Delivery', href: '/delivery', icon: Truck },
  { name: 'Finance', href: '/finance', icon: DollarSign, permission: 'finance:read' },
  { name: 'HR', href: '/hr', icon: UserCircle, permission: 'hr:read' },
  { name: 'Maintenance', href: '/maintenance', icon: Wrench, permission: 'maintenance:read' },
  { name: 'Reports', href: '/reports', icon: BarChart3, permission: 'reports:read' },
  { name: 'Settings', href: '/settings', icon: Settings, permission: 'settings:read' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { hasPermission } = useAuth();

  const filteredNav = navigation.filter(
    (item) => !item.permission || hasPermission(item.permission)
  );

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-16 items-center justify-between px-4 border-b border-gray-700">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Layers className="h-8 w-8 text-primary-400" />
            <div>
              <span className="text-white font-bold text-lg">{APP_NAME}</span>
              <p className="text-xs text-gray-400">{DESIGNER}</p>
            </div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-sidebar-hover"
        >
          <ChevronLeft className={clsx('h-5 w-5 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {filteredNav.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.name}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="p-4 border-t border-gray-700">
          <p className="text-xs text-gray-500 text-center">v{APP_VERSION} &copy; 2026</p>
          <p className="text-xs text-gray-600 text-center mt-1">Designed by {DESIGNER}</p>
        </div>
      )}
    </aside>
  );
}
