import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useInactivityLogout } from '../../hooks/useInactivityLogout';
import { INACTIVITY_TIMEOUT_MINUTES } from '../../config/session';
import { Button } from '../ui';

export function InactivityMonitor() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const navigate = useNavigate();

  const handleTimeout = useCallback(async () => {
    await logout();
    navigate('/login?reason=inactive', { replace: true });
  }, [logout, navigate]);

  const enabled = isAuthenticated && !isLoading;
  const { showWarning, staySignedIn } = useInactivityLogout({
    enabled,
    onTimeout: () => {
      void handleTimeout();
    },
  });

  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4">
      <div
        role="alertdialog"
        aria-labelledby="inactivity-title"
        aria-describedby="inactivity-desc"
        className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-float"
      >
        <h2 id="inactivity-title" className="text-lg font-semibold text-slate-900">
          Still there?
        </h2>
        <p id="inactivity-desc" className="mt-2 text-sm text-slate-600">
          You have been inactive for a while. For security, you will be signed out in a moment unless
          you continue working. Sessions expire after {INACTIVITY_TIMEOUT_MINUTES} minutes of
          inactivity.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => void handleTimeout()}>
            Sign out now
          </Button>
          <Button onClick={staySignedIn}>Stay signed in</Button>
        </div>
      </div>
    </div>
  );
}
