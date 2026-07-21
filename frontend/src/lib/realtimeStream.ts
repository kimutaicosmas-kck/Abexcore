import { apiUrl } from '../config/api';

export type RealtimeEvent = { type: string; at?: string };

export async function subscribeRealtimeEvents(
  signal: AbortSignal,
  onEvent: (event: RealtimeEvent) => void
): Promise<void> {
  const token = localStorage.getItem('accessToken');
  if (!token) return;

  const response = await fetch(apiUrl('/realtime/events'), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Realtime stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
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
}
