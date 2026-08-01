import { useState, useRef, useEffect } from 'react';
import { Bell, LogOut, Menu, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { useLocation, useNavigate } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';
import { NOTIFICATION_POLL_MS } from '../../config/realtime';
import { normalizeRoutePath } from '../../config/routeAccess';

interface TopNavProps {
  onMenuClick: () => void;
  sidebarOffset: string;
  mobileOpen?: boolean;
}

const routeTitles: Record<string, string> = {
  '/available-products': 'Available Products',
  '/my-leave': 'My Leave',
  '/': 'Dashboard',
  '/users': 'Users',
  '/customers': 'Customers',
  '/products': 'Products',
  '/inventory': 'Inventory',
  '/procurement': 'Procurement',
  '/production': 'Production',
  '/quality': 'Quality',
  '/sales': 'Sales',
  '/my-sales': 'My Sales',
  '/sales-performance': 'Sales Performance',
  '/delivery': 'Delivery',
  '/finance': 'Finance',
  '/hr': 'HR',
  '/maintenance': 'Maintenance',
  '/reports': 'Reports',
  '/settings': 'Settings',
};

export function TopNav({ onMenuClick, sidebarOffset }: TopNavProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => financeApi.notifications().then((r) => r.data.data),
    refetchInterval: NOTIFICATION_POLL_MS,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => financeApi.markNotificationRead(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData(['notifications'], (current: Array<{ id: string }> | undefined) =>
        (current || []).filter((n) => n.id !== id)
      );
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });

  const unreadNotifications =
    notifications?.filter((n: { isRead: boolean }) => !n.isRead) || [];
  const unreadCount = unreadNotifications.length;
  const pageTitle = routeTitles[normalizeRoutePath(location.pathname)] || 'Workspace';

  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';

  return (
    <>
      <header
        className="fixed top-0 right-0 z-40 h-14 bg-white border-b border-primary-100 shadow-sm shadow-primary-900/5 transition-all duration-300 lg:left-[var(--sidebar-w)] left-0"
        style={{ '--sidebar-w': sidebarOffset } as React.CSSProperties}
      >
        <div className="flex h-full items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={onMenuClick}
              className="lg:hidden p-2 rounded-xl hover:bg-primary-50 text-slate-600 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 shrink-0 max-w-[40vw] sm:max-w-none">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary-600/80 hidden sm:block">
                ApexCore ERP
              </p>
              <h1 className="text-sm font-semibold text-primary-950 truncate">{pageTitle}</h1>
            </div>
            <div className="hidden md:block flex-1 max-w-md min-w-0 ml-auto sm:ml-0">
              <GlobalSearch />
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              className="md:hidden p-2 rounded-xl hover:bg-primary-50 text-primary-700 transition-colors"
              aria-label={searchOpen ? 'Close search' : 'Open search'}
            >
              <Search className="h-[18px] w-[18px]" />
            </button>

            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-2 rounded-xl hover:bg-primary-50 text-primary-700 transition-colors"
              >
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-4 px-0.5 rounded-full bg-gradient-to-r from-red-500 to-rose-600 text-white text-[9px] font-bold flex items-center justify-center shadow-sm">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-primary-100 rounded-2xl shadow-float z-50 max-h-80 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-primary-100 bg-primary-50/90 text-xs font-semibold text-primary-900">
                    Notifications
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {!unreadNotifications.length ? (
                      <p className="px-4 py-8 text-xs text-slate-500 text-center">No new notifications</p>
                    ) : (
                      unreadNotifications.map((n: { id: string; title: string; message: string; isRead: boolean; link?: string }) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            markRead.mutate(n.id);
                            if (n.link) navigate(n.link);
                            setNotifOpen(false);
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-primary-50/80 border-b border-primary-50 text-sm transition-colors"
                        >
                          <p className="font-medium text-slate-900 text-xs">{n.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pl-2 ml-1 border-l border-primary-100">
              <div className="hidden md:block text-right leading-tight">
                <p className="text-xs font-semibold text-slate-900">{user?.firstName} {user?.lastName}</p>
                <p className="text-[11px] text-primary-600 font-medium">{user?.role.name}</p>
              </div>
              <div className="h-9 w-9 rounded-lg bg-primary-600 flex items-center justify-center text-white text-xs font-bold">
                {initials}
              </div>
              <button
                onClick={handleLogout}
                className="p-2 rounded-xl hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="md:hidden fixed top-14 left-0 right-0 z-40 border-b border-primary-100 bg-white px-4 py-3 shadow-sm lg:left-[var(--sidebar-w)]">
          <GlobalSearch />
        </div>
      )}
    </>
  );
}
