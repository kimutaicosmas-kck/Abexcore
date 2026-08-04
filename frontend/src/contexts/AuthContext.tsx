import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../types';
import {
  authApi,
  refreshAccessToken,
  clearStoredSession,
  isAccessTokenExpired,
  redirectToLogin,
  SESSION_EXPIRED_EVENT,
} from '../services/api';
import { canAccessRoute as checkRouteAccess } from '../config/routeAccess';
import { clearUserActivity, isInactivityExpired, markUserActivity } from '../config/session';
import { PLATFORM_COMPANY_SLUG } from '../constants/platform';

function parseCompany(data: unknown): CompanyConfig | null {
  if (!data || typeof data !== 'object') return null;
  const c = data as CompanyConfig;
  if (!c.name) return null;
  return c;
}

export interface CompanyConfig {
  id?: string;
  slug?: string;
  name: string;
  logo?: string | null;
  vatRate: number;
  currency: string;
}

interface AuthContextType {
  user: User | null;
  company: CompanyConfig | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isPlatformOwner: boolean;
  isSalesOfficer: boolean;
  isDriver: boolean;
  mustChangePassword: boolean;
  login: (companySlug: string, email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  canAccessRoute: (pathname: string) => boolean;
  refreshUser: () => Promise<void>;
  clearMustChangePassword: () => void;
  setCompany: (c: CompanyConfig) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<CompanyConfig | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const { data } = await authApi.me();
    setUser(data.data);
    setCompany(parseCompany(data.data.company));
  }, []);

  useEffect(() => {
    const onSessionExpired = () => {
      setUser(null);
      setCompany(null);
      setMustChangePassword(false);
      clearUserActivity();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const dropSession = (reason: 'session' | 'inactive' = 'session') => {
      clearStoredSession();
      clearUserActivity();
      setUser(null);
      setCompany(null);
      if (!cancelled) redirectToLogin(reason);
    };

    const loadSession = async () => {
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');

      if (!accessToken && !refreshToken) {
        setIsLoading(false);
        return;
      }

      if (isInactivityExpired()) {
        dropSession('inactive');
        setIsLoading(false);
        return;
      }

      const restoreUser = async () => {
        const token = localStorage.getItem('accessToken');
        if (!token || isAccessTokenExpired(token)) {
          if (!localStorage.getItem('refreshToken')) throw new Error('Session expired');
          const refreshed = await refreshAccessToken();
          if (!refreshed) throw new Error('Session expired');
        }

        const { data } = await authApi.me();
        if (cancelled) return false;
        setUser(data.data);
        setCompany(parseCompany(data.data.company));
        setMustChangePassword(!!data.data.mustChangePassword);
        markUserActivity();
        return true;
      };

      try {
        await restoreUser();
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        const sessionGone =
          status === 401 ||
          status === 403 ||
          String((err as Error)?.message || '').includes('Session expired');

        if (sessionGone) {
          dropSession('session');
        } else {
          // Transient network/5xx on F5 — one retry after token refresh, do not wipe session.
          try {
            await refreshAccessToken();
            await restoreUser();
          } catch (retryErr: unknown) {
            const retryStatus = (retryErr as { response?: { status?: number } })?.response?.status;
            if (retryStatus === 401 || retryStatus === 403) {
              dropSession('session');
            }
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Quietly renew access tokens in the background so users are not kicked mid-work.
  useEffect(() => {
    if (!user) return;

    const renewIfNeeded = () => {
      if (isInactivityExpired()) return;
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return;
      if (!accessToken || isAccessTokenExpired(accessToken)) {
        void refreshAccessToken();
      }
    };

    renewIfNeeded();
    const id = window.setInterval(renewIfNeeded, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') renewIfNeeded();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  const login = async (companySlug: string, email: string, password: string, totpCode?: string) => {
    const { data } = await authApi.login(companySlug, email, password, totpCode);
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    if (data.data.company?.slug) {
      localStorage.setItem('companySlug', data.data.company.slug);
    }
    markUserActivity();
    setUser(data.data.user);
    setMustChangePassword(!!data.data.mustChangePassword);
    if (data.data.company) setCompany(data.data.company);
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try {
      await authApi.logout(refreshToken || undefined);
    } catch {
      // ignore
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    clearUserActivity();
    setUser(null);
    setCompany(null);
    setMustChangePassword(false);
  };

  const isPlatformOwner =
    user?.role?.name === 'Super Admin' && company?.slug === PLATFORM_COMPANY_SLUG;

  const hasPermission = (permission: string) => {
    if (!user) return false;
    if (user.role.name === 'Super Admin') return true;
    return user.permissions.includes(permission);
  };

  const canAccessRoute = (pathname: string) => checkRouteAccess(pathname, hasPermission);

  return (
    <AuthContext.Provider
      value={{
        user,
        company,
        isLoading,
        isAuthenticated: !!user,
        isSuperAdmin: user?.role?.name === 'Super Admin',
        isPlatformOwner,
        isSalesOfficer: ['Sales Officer', 'Sales Representative', 'Sales Manager'].includes(
          user?.role?.name || ''
        ),
        isDriver: user?.role?.name === 'Driver',
        mustChangePassword,
        login,
        logout,
        hasPermission,
        canAccessRoute,
        refreshUser,
        clearMustChangePassword: () => setMustChangePassword(false),
        setCompany,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function useVatRate(): number {
  const { company } = useAuth();
  return company?.vatRate ?? 16;
}
