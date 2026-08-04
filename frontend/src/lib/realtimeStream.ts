import { apiUrl } from '../config/api';
import { clearStoredSession, redirectToLogin, refreshAccessToken } from '../services/api';

export type RealtimeEvent = { type: string; at?: string };

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

async function openRealtimeStream(signal: AbortSignal): Promise<Response | null> {
  const token = localStorage.getItem('accessToken');
  if (!token || signal.aborted) return null;

  return fetch(apiUrl('/realtime/events'), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
    cache: 'no-store',
    signal,
  });
}

/** Long-lived SSE; network/proxy drops (e.g. HTTP/2 ping) are normal — caller should reconnect. */
export async function subscribeRealtimeEvents(
  signal: AbortSignal,
  onEvent: (event: RealtimeEvent) => void
): Promise<void> {
  let response: Response | null;
  try {
    response = await openRealtimeStream(signal);
    if (!response) return;

    // Access token often expires while the tab stays open — refresh once and retry.
    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        clearStoredSession();
        redirectToLogin('session');
        return;
      }
      response = await openRealtimeStream(signal);
      if (!response) return;
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) return;
    throw err;
  }

  if (!response.ok || !response.body) {
    throw new Error(`Realtime stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) continue;
        try {
          onEvent(JSON.parse(dataLine.slice(6)) as RealtimeEvent);
        } catch {
          /* ignore malformed events */
        }
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) return;
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already closed */
    }
  }
}
