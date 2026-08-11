import { useState, useRef, useEffect } from 'react';
import { Bell, LogOut, Menu } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { useLocation, useNavigate } from 'react-router-dom';
import { NOTIFICATION_POLL_MS } from '../../config/realtime';
import { accountNavLabel, normalizeRoutePath } from '../../config/routeAccess';
import { APP_NAME } from '../../constants/brand';
import { UserAvatar } from '../ui/UserAvatar';

interface TopNavProps {
  onMenuClick: () => void;
  sidebarOffset: string;
  mobileOpen?: boolean;
}

const routeTitles: Record<string, string> = {
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
};

export function TopNav({ onMenuClick, sidebarOffset }: TopNavProps) {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => financeApi.notifications().then((r) => r.data.data),
    refetchInterval: NOTIFICATION_POLL_MS,
    enabled: !!user,
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

  const markAllRead = useMutation({
    mutationFn: () => financeApi.markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.setQueryData(['notifications'], []);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });

  const unreadNotifications =
    notifications?.filter((n: { isRead: boolean }) => !n.isRead) || [];
  const unreadCount = unreadNotifications.length;
  const routeKey = normalizeRoutePath(location.pathname);
  const displayName = user?.firstName?.trim() || user?.email?.split('@')[0] || 'there';
  const pageTitle =
    routeKey === '/account'
      ? accountNavLabel(hasPermission('settings:read'))
      : routeTitles[routeKey] || 'Workspace';
  const isDashboard = routeKey === '/';

  useEffect(() => {
    setNotifOpen(false);
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

  return (
    <header
      className="mobile-top-bar fixed top-0 right-0 z-40 transition-all duration-300 lg:left-[var(--sidebar-w)] left-0"
      style={{ '--sidebar-w': sidebarOffset } as React.CSSProperties}
    >
      <div className="flex h-14 items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2.5 rounded-2xl bg-primary-50/80 hover:bg-primary-100 text-primary-800 transition-colors active:scale-95"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-600/80 hidden sm:block">
              {APP_NAME}
            </p>
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-[15px] sm:text-sm font-semibold text-primary-950 truncate tracking-tight">
                {pageTitle}
              </h1>
              {isDashboard && (
                <p className="hidden md:block text-sm text-slate-500 truncate">
                  Welcome back, <span className="font-medium text-primary-700">{displayName}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="relative p-2 rounded-xl hover:bg-primary-50 text-primary-700 transition-colors"
              aria-label="Notifications"
              aria-expanded={notifOpen}
            >
              <Bell className="h-[18px] w-[18px]" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 min-w-4 px-0.5 rounded-full bg-gradient-to-r from-red-500 to-rose-600 text-white text-[9px] font-bold flex items-center justify-center shadow-sm">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close notifications"
                  className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px] md:hidden"
                  onClick={() => setNotifOpen(false)}
                />
                <div className="fixed left-3 right-3 top-[calc(3.5rem+env(safe-area-inset-top)+0.35rem)] z-50 max-h-[min(70dvh,22rem)] overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-float md:absolute md:left-auto md:right-0 md:inset-x-auto md:top-full md:mt-2 md:w-80 md:max-h-80">
                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-primary-100 bg-primary-50/90">
                    <p className="text-xs font-semibold text-primary-900">Notifications</p>
                    <div className="flex items-center gap-1">
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          className="text-xs font-medium text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-100 disabled:opacity-50"
                          disabled={markAllRead.isPending}
                          onClick={() => markAllRead.mutate()}
                        >
                          Mark all read
                        </button>
                      )}
                      <button
                        type="button"
                        className="md:hidden text-xs font-medium text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-100"
                        onClick={() => setNotifOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[min(58dvh,18rem)] md:max-h-64 overflow-y-auto overscroll-contain">
                    {!unreadNotifications.length ? (
                      <p className="px-4 py-10 text-xs text-slate-500 text-center">No new notifications</p>
                    ) : (
                      unreadNotifications.map((n: { id: string; title: string; message: string; isRead: boolean; link?: string }) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-2 px-3 py-3 border-b border-primary-50 hover:bg-primary-50/80 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              markRead.mutate(n.id);
                              if (n.link) navigate(n.link);
                              setNotifOpen(false);
                            }}
                            className="min-w-0 flex-1 text-left text-sm"
                          >
                            <p className="font-medium text-slate-900 text-xs">{n.title}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                          </button>
                          <button
                            type="button"
                            title="Mark as read"
                            disabled={markRead.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              markRead.mutate(n.id);
                            }}
                            className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-100 disabled:opacity-50"
                          >
                            Read
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-primary-100">
            <div className="hidden md:block text-right leading-tight">
              <p className="text-xs font-semibold text-slate-900">{user?.firstName} {user?.lastName}</p>
              <p className="text-[11px] text-primary-600 font-medium">{user?.role.name}</p>
            </div>
            <UserAvatar
              firstName={user?.firstName}
              lastName={user?.lastName}
              avatar={user?.avatar}
              size="sm"
            />
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
  );
}
