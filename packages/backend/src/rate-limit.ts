/** Fixed-window counters in memory: enough for the single-process PoC (ADR-016, ADR-018). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /** Counts one event for `key`; false when the limit for the current window is exceeded. */
  allow(key: string, limit: number, windowSeconds: number): boolean {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= windowSeconds) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count++;
    return window.count <= limit;
  }
}
