export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;

  constructor(
    readonly name: string,
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000
  ) {}

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      cooldownMs: this.cooldownMs,
    };
  }

  isOpen(): boolean {
    if (this.state !== 'open') return false;
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
      return false;
    }
    return true;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error(`Service "${this.name}" is temporarily unavailable (circuit open)`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, threshold?: number, cooldownMs?: number) {
  const key = name.trim().toLowerCase();
  let breaker = breakers.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(name, threshold, cooldownMs);
    breakers.set(key, breaker);
  }
  return breaker;
}

export function listCircuitBreakers() {
  return [...breakers.values()].map((breaker) => breaker.getStatus());
}
