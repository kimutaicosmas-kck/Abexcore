type AxiosLikeError = {
  response?: { data?: { message?: string; code?: string }; status?: number };
  code?: string;
  message?: string;
};

export function getApiErrorCode(err: unknown): string | undefined {
  if (err == null) return undefined;
  return (err as AxiosLikeError).response?.data?.code;
}

export function getApiErrorMessage(err: unknown): string {
  if (err == null) {
    return 'Something went wrong. Please try again.';
  }

  const axiosErr = err as AxiosLikeError;

  if (axiosErr.response?.data?.message) {
    return axiosErr.response.data.message;
  }

  if (axiosErr.response?.status === 429) {
    return 'Too many requests. Wait a minute and try again, or refresh the page.';
  }

  if (axiosErr.response?.status === 401) {
    return 'Your session expired. Please sign in again.';
  }

  if (!axiosErr.response) {
    if (axiosErr.code === 'ECONNABORTED') {
      return 'Request timed out. Check your connection and try again.';
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'You appear to be offline. Connect to Wi-Fi or mobile data and try again.';
    }
    return 'Cannot reach the server. Use the same Wi-Fi as this PC, or open the latest HTTPS link shared for mobile access.';
  }

  return 'Something went wrong. Please try again.';
}
