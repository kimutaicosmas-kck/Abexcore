import clsx from 'clsx';
import { AlertCircle, Clock, CloudOff, RefreshCw, ServerCrash, WifiOff } from 'lucide-react';
import {
  ApiErrorKind,
  classifyApiError,
  getApiErrorHint,
  getApiErrorMessage,
  getApiErrorTitle,
  isNetworkRelatedError,
} from '../../utils/apiError';

const KIND_STYLES: Record<
  ApiErrorKind,
  { ring: string; bg: string; icon: string; Icon: typeof WifiOff }
> = {
  offline: {
    ring: 'ring-amber-200',
    bg: 'bg-amber-50',
    icon: 'text-amber-700',
    Icon: WifiOff,
  },
  timeout: {
    ring: 'ring-amber-200',
    bg: 'bg-amber-50',
    icon: 'text-amber-700',
    Icon: Clock,
  },
  network: {
    ring: 'ring-sky-200',
    bg: 'bg-sky-50',
    icon: 'text-sky-700',
    Icon: CloudOff,
  },
  server: {
    ring: 'ring-orange-200',
    bg: 'bg-orange-50',
    icon: 'text-orange-700',
    Icon: ServerCrash,
  },
  unauthorized: {
    ring: 'ring-red-200',
    bg: 'bg-red-50',
    icon: 'text-red-700',
    Icon: AlertCircle,
  },
  rate_limit: {
    ring: 'ring-amber-200',
    bg: 'bg-amber-50',
    icon: 'text-amber-700',
    Icon: Clock,
  },
  api: {
    ring: 'ring-red-200',
    bg: 'bg-red-50',
    icon: 'text-red-700',
    Icon: AlertCircle,
  },
  unknown: {
    ring: 'ring-red-200',
    bg: 'bg-red-50',
    icon: 'text-red-700',
    Icon: AlertCircle,
  },
};

interface ConnectionErrorAlertProps {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

/** Rich banner for offline / connectivity failures. */
export function ConnectionErrorAlert({ error, onRetry, compact, className }: ConnectionErrorAlertProps) {
  if (!error) return null;

  const kind = classifyApiError(error);
  const styles = KIND_STYLES[kind];
  const Icon = styles.Icon;
  const title = getApiErrorTitle(error);
  const message = getApiErrorMessage(error);
  const hint = getApiErrorHint(error);

  return (
    <div
      className={clsx(
        'rounded-xl ring-1',
        styles.ring,
        styles.bg,
        compact ? 'px-3 py-2.5' : 'px-4 py-3.5',
        className
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className={clsx('mt-0.5 shrink-0 rounded-lg bg-white/70 p-1.5', styles.icon)}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={clsx('font-semibold text-slate-900', compact ? 'text-sm' : 'text-sm')}>{title}</p>
          <p className={clsx('text-slate-700', compact ? 'text-xs' : 'text-sm')}>{message}</p>
          {hint && !compact && <p className="text-xs text-slate-500 leading-relaxed">{hint}</p>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={clsx(
              'inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200 hover:bg-white',
              compact && 'self-center'
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

interface ApiErrorAlertProps {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

/** Uses the rich connection banner for network issues; plain alert for API validation errors. */
export function ApiErrorAlert({ error, onRetry, compact, className }: ApiErrorAlertProps) {
  if (!error) return null;

  if (isNetworkRelatedError(error)) {
    return (
      <ConnectionErrorAlert error={error} onRetry={onRetry} compact={compact} className={className} />
    );
  }

  return (
    <div className={clsx('px-3 py-2 rounded-lg text-sm ring-1 bg-red-50 text-red-800 ring-red-200', className)}>
      {getApiErrorMessage(error)}
    </div>
  );
}
