import clsx from 'clsx';
import { Modal } from './Modal';
import { getApiErrorMessage } from '../../utils/apiError';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="md">
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-xl border border-border bg-white text-slate-700 hover:bg-surface-muted disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={clsx(
            'inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-xl text-white disabled:opacity-50',
            variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
          )}
        >
          {loading ? 'Please wait…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

interface QueryErrorAlertProps {
  error: unknown;
  onRetry?: () => void;
}

export { getApiErrorMessage } from '../../utils/apiError';

export function QueryErrorAlert({ error, onRetry }: QueryErrorAlertProps) {
  if (!error) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
      <span>{getApiErrorMessage(error)}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium underline shrink-0">
          Retry
        </button>
      )}
    </div>
  );
}
