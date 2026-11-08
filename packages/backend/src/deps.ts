import type { Config } from './config.ts';
import type { Sql } from './db.ts';
import type { KeyStore } from './keys.ts';
import type { RateLimiter } from './rate-limit.ts';

/** Everything the API and the workers share. One instance per process. */
export type Deps = {
  sql: Sql;
  config: Config;
  keyStore: KeyStore;
  /** Unix seconds. */
  now: () => number;
  limiter: RateLimiter;
  /** Chains whose batcher must flush on its next tick (demo flush-now, ADR-006). */
  flushRequests: Set<number>;
};
