import { QueryErrorAlert } from './ConfirmDialog';

interface PageQueryStatusProps {
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Standard error banner for list pages missing dedicated error UI. */
export function PageQueryStatus({ isError, error, onRetry }: PageQueryStatusProps) {
  if (!isError) return null;
  return (
    <div className="mb-4">
      <QueryErrorAlert error={error} onRetry={onRetry} />
    </div>
  );
}
