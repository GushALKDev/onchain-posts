/** Fixed-window counters in memory: enough for the single-process PoC (ADR-016, ADR-018). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number; windowSeconds: number }>();
  private readonly now: () => number;
  private lastSweep: number;

  constructor(now: () => number) {
    this.now = now;
    this.lastSweep = now();
  }

  /** Number of keys currently tracked. */
  get size(): number {
    return this.windows.size;
  }

  /** Counts one event for `key`; false when the limit for the current window is exceeded. */
  allow(key: string, limit: number, windowSeconds: number): boolean {
    const now = this.now();
    this.sweep(now);
    const window = this.windows.get(key);
    if (!window || now - window.start >= windowSeconds) {
      this.windows.set(key, { start: now, count: 1, windowSeconds });
      return true;
    }
    window.count++;
    return window.count <= limit;
  }

  /** Drops expired windows at most once a minute, so memory is bounded by the keys seen recently, not since start. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) if (now - window.start >= window.windowSeconds) this.windows.delete(key);
  }
}
