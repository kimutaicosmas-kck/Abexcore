import { getCircuitBreaker } from './circuitBreaker';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResilientFetchOptions = {
  service?: string;
  timeoutMs?: number;
  retries?: number;
};

/**
 * HTTP fetch with timeout, retries, and per-integration circuit breaker.
 * Prevents one failing external API from stalling or repeatedly hammering the system.
 */
export async function resilientFetch(
  url: string,
  init?: RequestInit,
  opts: ResilientFetchOptions = {}
): Promise<Response> {
  const service = opts.service || 'external';
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const breaker = getCircuitBreaker(service);

  return breaker.exec(async () => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timer);
        return response;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < retries) {
          await sleep(2 ** attempt * 400);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  });
}
