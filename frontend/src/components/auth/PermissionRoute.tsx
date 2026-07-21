import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAccessRoute } from '../../config/routeAccess';

interface PermissionRouteProps {
  children: React.ReactNode;
}

export function PermissionRoute({ children }: PermissionRouteProps) {
  const { hasPermission } = useAuth();
  const location = useLocation();

  if (!canAccessRoute(location.pathname, hasPermission)) {
    return <Navigate to="/" replace state={{ accessDenied: true, from: location.pathname }} />;
  }

  return <>{children}</>;
}
