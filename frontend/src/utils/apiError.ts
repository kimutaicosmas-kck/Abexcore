type AxiosLikeError = {
  response?: { data?: { message?: string; code?: string }; status?: number };
  code?: string;
  message?: string;
};

export type ApiErrorKind =
  | 'offline'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'rate_limit'
  | 'server'
  | 'api'
  | 'unknown';

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

export function getApiErrorCode(err: unknown): string | undefined {
  if (err == null) return undefined;
  return (err as AxiosLikeError).response?.data?.code;
}

export function classifyApiError(err: unknown): ApiErrorKind {
  if (err == null) return 'unknown';

  const axiosErr = err as AxiosLikeError;

  if (axiosErr.response?.status === 401) return 'unauthorized';
  if (axiosErr.response?.status === 429) return 'rate_limit';
  if (axiosErr.response?.status && axiosErr.response.status >= 500) return 'server';
  if (axiosErr.response?.data?.message) return 'api';

  if (!axiosErr.response) {
    if (axiosErr.code === 'ECONNABORTED') return 'timeout';
    if (isBrowserOffline()) return 'offline';
    return 'network';
  }

  return 'unknown';
}

export function isNetworkRelatedError(err: unknown): boolean {
  const kind = classifyApiError(err);
  return kind === 'offline' || kind === 'timeout' || kind === 'network' || kind === 'server';
}

export function getApiErrorTitle(err: unknown): string {
  switch (classifyApiError(err)) {
    case 'offline':
      return 'No internet connection';
    case 'timeout':
      return 'Connection timed out';
    case 'network':
      return "Can't reach AbexCore";
    case 'unauthorized':
      return 'Session expired';
    case 'rate_limit':
      return 'Too many requests';
    case 'server':
      return 'Service temporarily unavailable';
    case 'api':
      return 'Something went wrong';
    default:
      return 'Something went wrong';
  }
}

export function getApiErrorHint(err: unknown): string | undefined {
  switch (classifyApiError(err)) {
    case 'offline':
      return 'Turn on Wi‑Fi or mobile data. If you are connected, try toggling airplane mode off.';
    case 'timeout':
      return 'Your connection may be slow or unstable. Move to a stronger signal and try again.';
    case 'network':
      return 'This is usually temporary. If it continues, contact your administrator or try again later.';
    case 'server':
      return 'Our servers may be busy or undergoing maintenance. Please try again in a few minutes.';
    case 'rate_limit':
      return 'Wait a minute before trying again.';
    default:
      return undefined;
  }
}

export function getApiErrorMessage(err: unknown): string {
  if (err == null) {
    return 'Something went wrong. Please try again.';
  }

  const axiosErr = err as AxiosLikeError;

  if (axiosErr.response?.data?.message) {
    return axiosErr.response.data.message;
  }

  switch (classifyApiError(err)) {
    case 'offline':
      return 'You are offline. Connect to the internet to load live data and sign in.';
    case 'timeout':
      return 'The request took too long. Check your connection and try again.';
    case 'network':
      return 'We could not connect to AbexCore. Check your internet connection and try again.';
    case 'unauthorized':
      return 'Your session expired. Please sign in again.';
    case 'rate_limit':
      return 'Too many requests. Wait a minute and try again, or refresh the page.';
    case 'server':
      return 'AbexCore is temporarily unavailable. Please try again shortly.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
