import { Link } from 'react-router-dom';
import { Home, SearchX } from 'lucide-react';
import { Button } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-subtle p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
          <SearchX className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          The page you requested does not exist or you may not have access to it.
        </p>
        <Link to="/" className="inline-block mt-6">
          <Button>
            <Home className="h-4 w-4 mr-2" />
            Back to dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
