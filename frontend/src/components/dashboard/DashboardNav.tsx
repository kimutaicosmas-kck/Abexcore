import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function DashboardModuleLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { canAccessRoute } = useAuth();

  if (!canAccessRoute(to)) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

export function useDashboardNavigation() {
  const navigate = useNavigate();
  const { canAccessRoute } = useAuth();

  return {
    canOpen: canAccessRoute,
    openModule: (path: string) => {
      if (canAccessRoute(path)) navigate(path);
    },
  };
}
