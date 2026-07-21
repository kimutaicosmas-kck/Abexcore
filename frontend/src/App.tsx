import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { CustomersPage } from './pages/CustomersPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { ProcurementPage } from './pages/ProcurementPage';
import { ProductionPage } from './pages/ProductionPage';
import { SalesPage } from './pages/SalesPage';
import { FinancePage } from './pages/FinancePage';
import { HRPage } from './pages/HRPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { QualityPage } from './pages/QualityPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeliveryPage } from './pages/DeliveryPage';
import { MySalesPage } from './pages/MySalesPage';
import { SalesPerformancePage } from './pages/SalesPerformancePage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PermissionRoute } from './components/auth/PermissionRoute';
import { InactivityMonitor } from './components/auth/InactivityMonitor';
import { LoadingSpinner, ErrorBoundary } from './components/ui';
import { LIVE_STALE_MS } from './config/realtime';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: LIVE_STALE_MS,
      gcTime: 5 * 60_000,
    },
  },
});

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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<PasswordChangeRoute><ChangePasswordPage /></PasswordChangeRoute>} />
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
        <Route path="sales-performance" element={<PermissionRoute><SalesPerformancePage /></PermissionRoute>} />
        <Route path="sales-targets" element={<Navigate to="/sales-performance?tab=targets" replace />} />
        <Route path="delivery" element={<PermissionRoute><DeliveryPage /></PermissionRoute>} />
        <Route path="finance" element={<PermissionRoute><FinancePage /></PermissionRoute>} />
        <Route path="hr" element={<PermissionRoute><HRPage /></PermissionRoute>} />
        <Route path="maintenance" element={<PermissionRoute><MaintenancePage /></PermissionRoute>} />
        <Route path="reports" element={<PermissionRoute><ReportsPage /></PermissionRoute>} />
        <Route path="settings" element={<PermissionRoute><SettingsPage /></PermissionRoute>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <InactivityMonitor />
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
