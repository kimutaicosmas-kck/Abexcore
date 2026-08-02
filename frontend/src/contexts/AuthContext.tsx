import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../types';
import { authApi, refreshAccessToken, clearStoredSession, isAccessTokenExpired } from '../services/api';
import { canAccessRoute as checkRouteAccess } from '../config/routeAccess';
import { clearUserActivity, getLastActivityAt, isInactivityExpired, markUserActivity } from '../config/session';
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
    let cancelled = false;

    const loadSession = async () => {
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');

      if (!accessToken && !refreshToken) {
        setIsLoading(false);
        return;
      }

      if (isInactivityExpired()) {
        clearStoredSession();
        clearUserActivity();
        setIsLoading(false);
        return;
      }

      try {
        if (!accessToken || isAccessTokenExpired(accessToken)) {
          if (!refreshToken) throw new Error('Session expired');
          const refreshed = await refreshAccessToken();
          if (!refreshed) throw new Error('Session expired');
        }

        const { data } = await authApi.me();
        if (cancelled) return;
        setUser(data.data);
        setCompany(parseCompany(data.data.company));
        if (getLastActivityAt() == null) {
          markUserActivity();
        }
      } catch {
        if (cancelled) return;
        clearStoredSession();
        clearUserActivity();
        setUser(null);
        setCompany(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

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
