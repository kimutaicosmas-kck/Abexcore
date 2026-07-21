import { useState, useRef, useEffect } from 'react';
import { Bell, LogOut, Menu, User } from 'lucide-react';
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

  return (
    <header
      className="fixed top-0 right-0 z-40 h-14 border-b border-slate-200 bg-white shadow-sm transition-all duration-300 lg:left-[var(--sidebar-w)] left-0"
      style={{ '--sidebar-w': sidebarOffset } as React.CSSProperties}
    >
      <div className="flex h-full items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold text-slate-800 truncate shrink-0 max-w-[40vw] sm:max-w-none">
            {pageTitle}
          </h1>
          <div className="hidden md:block flex-1 max-w-md min-w-0 ml-auto sm:ml-0">
            <GlobalSearch />
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            >
              <Bell className="h-[18px] w-[18px]" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-3.5 min-w-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-80 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-700">
                  Notifications
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {!unreadNotifications.length ? (
                    <p className="px-3 py-6 text-xs text-slate-500 text-center">No new notifications</p>
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
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-50 text-sm bg-primary-50/50"
                      >
                        <p className="font-medium text-slate-900 text-xs">{n.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{n.message}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
            <div className="hidden md:block text-right leading-tight">
              <p className="text-xs font-semibold text-slate-900">{user?.firstName} {user?.lastName}</p>
              <p className="text-[10px] text-slate-500">{user?.role.name}</p>
            </div>
            <div className="h-8 w-8 rounded-lg bg-primary-100 flex items-center justify-center">
              <User className="h-4 w-4 text-primary-700" />
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
