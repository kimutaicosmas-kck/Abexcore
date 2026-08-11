import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { PermissionRoute } from './components/auth/PermissionRoute';
import { InactivityMonitor } from './components/auth/InactivityMonitor';
import { LoadingSpinner, ErrorBoundary } from './components/ui';
import { LIVE_STALE_MS } from './config/realtime';
import { PwaShell } from './components/pwa/PwaShell';

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterCompanyPage = lazy(() =>
  import('./pages/RegisterCompanyPage').then((m) => ({ default: m.RegisterCompanyPage }))
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const CustomersPage = lazy(() =>
  import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage }))
);
const ProductsPage = lazy(() =>
  import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage }))
);
const InventoryPage = lazy(() =>
  import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage }))
);
const ProcurementPage = lazy(() =>
  import('./pages/ProcurementPage').then((m) => ({ default: m.ProcurementPage }))
);
const ProductionPage = lazy(() =>
  import('./pages/ProductionPage').then((m) => ({ default: m.ProductionPage }))
);
const SalesPage = lazy(() => import('./pages/SalesPage').then((m) => ({ default: m.SalesPage })));
const FinancePage = lazy(() =>
  import('./pages/FinancePage').then((m) => ({ default: m.FinancePage }))
);
const HRPage = lazy(() => import('./pages/HRPage').then((m) => ({ default: m.HRPage })));
const MaintenancePage = lazy(() =>
  import('./pages/MaintenancePage').then((m) => ({ default: m.MaintenancePage }))
);
const QualityPage = lazy(() =>
  import('./pages/QualityPage').then((m) => ({ default: m.QualityPage }))
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const DeliveryPage = lazy(() =>
  import('./pages/DeliveryPage').then((m) => ({ default: m.DeliveryPage }))
);
const MySalesPage = lazy(() =>
  import('./pages/MySalesPage').then((m) => ({ default: m.MySalesPage }))
);
const MyLeavePage = lazy(() =>
  import('./pages/MyLeavePage').then((m) => ({ default: m.MyLeavePage }))
);
const SalesPerformancePage = lazy(() =>
  import('./pages/SalesPerformancePage').then((m) => ({ default: m.SalesPerformancePage }))
);
const ChangePasswordPage = lazy(() =>
  import('./pages/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage }))
);
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((m) => ({ default: m.AccountPage }))
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) return false;
        return count < 1;
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: LIVE_STALE_MS,
      gcTime: 5 * 60_000,
    },
  },
});

// Drop cached queries immediately when the session dies (stops 401 refetch loops).
if (typeof window !== 'undefined') {
  window.addEventListener('abexcore:session-expired', () => {
    queryClient.cancelQueries();
    queryClient.clear();
  });
}

function PageFallback() {
  return <LoadingSpinner className="min-h-[40vh]" size="lg" />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();

  if (isLoading) {
    return <LoadingSpinner className="min-h-screen" size="lg" />;
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

function PasswordChangeRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  if (isLoading) return <LoadingSpinner className="min-h-screen" size="lg" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!mustChangePassword) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PlatformOwnerRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isPlatformOwner, mustChangePassword } = useAuth();

  if (isLoading) return <LoadingSpinner className="min-h-screen" size="lg" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!isPlatformOwner) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<Navigate to="/admin/register-company" replace />} />
        <Route
          path="/change-password"
          element={
            <PasswordChangeRoute>
              <ChangePasswordPage />
            </PasswordChangeRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<PermissionRoute><UsersPage /></PermissionRoute>} />
          <Route path="customers" element={<PermissionRoute><CustomersPage /></PermissionRoute>} />
          <Route path="products" element={<PermissionRoute><ProductsPage /></PermissionRoute>} />
          <Route path="inventory" element={<PermissionRoute><InventoryPage /></PermissionRoute>} />
          <Route path="procurement" element={<PermissionRoute><ProcurementPage /></PermissionRoute>} />
          <Route path="production" element={<PermissionRoute><ProductionPage /></PermissionRoute>} />
          <Route path="quality" element={<PermissionRoute><QualityPage /></PermissionRoute>} />
          <Route path="sales" element={<PermissionRoute><SalesPage /></PermissionRoute>} />
          <Route path="my-sales" element={<PermissionRoute><MySalesPage /></PermissionRoute>} />
          <Route path="available-products" element={<Navigate to="/products?tab=available" replace />} />
          <Route
            path="sales-performance"
            element={<PermissionRoute><SalesPerformancePage /></PermissionRoute>}
          />
          <Route path="sales-targets" element={<Navigate to="/sales-performance?tab=targets" replace />} />
          <Route path="delivery" element={<PermissionRoute><DeliveryPage /></PermissionRoute>} />
          <Route path="finance" element={<PermissionRoute><FinancePage /></PermissionRoute>} />
          <Route path="hr" element={<PermissionRoute><HRPage /></PermissionRoute>} />
          <Route path="my-leave" element={<PermissionRoute><MyLeavePage /></PermissionRoute>} />
          <Route path="maintenance" element={<PermissionRoute><MaintenancePage /></PermissionRoute>} />
          <Route path="reports" element={<PermissionRoute><ReportsPage /></PermissionRoute>} />
          <Route path="settings" element={<Navigate to="/account?tab=settings" replace />} />
          <Route
            path="recycle-bin"
            element={<Navigate to="/account?tab=settings&panel=recycle-bin" replace />}
          />
          <Route path="account" element={<AccountPage />} />
          <Route
            path="admin/register-company"
            element={
              <PlatformOwnerRoute>
                <RegisterCompanyPage />
              </PlatformOwnerRoute>
            }
          />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <AuthProvider>
            <InactivityMonitor />
            <PwaShell />
            <AppRoutes />
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
