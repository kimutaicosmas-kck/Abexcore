import { useState, useRef, useEffect } from 'react';
import { Bell, LogOut, Menu, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { useNavigate } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';

interface TopNavProps {
  onMenuClick: () => void;
  sidebarCollapsed: boolean;
}

export function TopNav({ onMenuClick, sidebarCollapsed }: TopNavProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => financeApi.notifications().then((r) => r.data.data),
    refetchInterval: 60000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => financeApi.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = notifications?.filter((n: { isRead: boolean }) => !n.isRead).length || 0;

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
      className="fixed top-0 right-0 z-40 h-16 bg-white border-b border-gray-200 transition-all duration-300"
      style={{ left: sidebarCollapsed ? '4rem' : '16rem' }}
    >
      <div className="flex h-full items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <button onClick={onMenuClick} className="lg:hidden p-2 rounded-lg hover:bg-gray-100">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
        </div>

        <div className="flex items-center gap-4">
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative p-2 rounded-lg hover:bg-gray-100"
            >
              <Bell className="h-5 w-5 text-gray-600" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
                <div className="px-4 py-3 border-b font-medium text-sm">Notifications</div>
                {!notifications?.length ? (
                  <p className="px-4 py-6 text-sm text-gray-500 text-center">No notifications</p>
                ) : (
                  notifications.map((n: { id: string; title: string; message: string; isRead: boolean; link?: string; createdAt: string }) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        if (!n.isRead) markRead.mutate(n.id);
                        if (n.link) navigate(n.link);
                        setNotifOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 ${!n.isRead ? 'bg-primary-50/50' : ''}`}
                    >
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-gray-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500">{user?.role.name}</p>
            </div>
            <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center">
              <User className="h-5 w-5 text-primary-600" />
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
