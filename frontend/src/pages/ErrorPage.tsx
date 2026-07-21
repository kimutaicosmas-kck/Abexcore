import { AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui';

interface ErrorPageProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorPage({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again or contact support if the problem persists.',
  onRetry,
}: ErrorPageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-subtle p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-6 flex justify-center gap-3">
          {onRetry && (
            <Button onClick={onRetry}>Try again</Button>
          )}
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
