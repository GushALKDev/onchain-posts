import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Hex } from 'viem';
import { acceptPost } from './api/posts.ts';
import { disclose } from './api/disclosure.ts';
import { postStatus, proofBundle } from './api/read.ts';
import type { Deps } from './deps.ts';
import { ApiError } from './errors.ts';
import { log } from './log.ts';
import type { MemoryStorage } from './storage.ts';

const POST_HASH = /^0x[0-9a-fA-F]{64}$/;

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * HTTP API (ADR-016). `clientIp` comes from the socket in production and from a header in tests. `devGateway` serves
 * in-memory uploads like an Arweave gateway, for local runs with STORAGE_MODE=memory only.
 */
export function createApp(deps: Deps, clientIp: (c: Context) => string, options: { devGateway?: MemoryStorage } = {}) {
  const app = new Hono();

  if (deps.config.webOrigins.length > 0) {
    app.use('*', cors({ origin: deps.config.webOrigins, allowHeaders: ['content-type', 'x-demo-flush-token'], allowMethods: ['GET', 'POST'] }));
  }

  app.use('*', async (c, next) => {
    if (!deps.limiter.allow(`ip:${clientIp(c)}`, deps.config.limits.requestsPerIpPerMinute, 60)) throw new ApiError(429, 'rate-limited', 'too many requests');
    await next();
  });

  // About 95 KiB of image in base64 plus the JSON envelope.
  app.post('/posts', bodyLimit({ maxSize: 160 * 1024, onError: () => { throw new ApiError(413, 'too-large', 'request body too large'); } }), async (c) =>
    c.json(await acceptPost(deps, await c.req.json().catch(() => null)), 202),
  );

  const postHashParam = (c: Context) => {
    const value = c.req.param('postHash') ?? '';
    if (!POST_HASH.test(value)) throw new ApiError(400, 'invalid-post-hash', 'postHash must be 32-byte hex');
    return value.toLowerCase() as Hex;
  };

  app.get('/proof/:postHash', async (c) => {
    const bundle = await proofBundle(deps.sql, postHashParam(c));
    return bundle ? c.json(bundle) : c.json({ state: 'RECEIVED', message: 'not stored on Arweave yet' }, 202);
  });

  app.get('/status/:postHash', async (c) => c.json(await postStatus(deps.sql, postHashParam(c))));

  app.post('/disclosure', async (c) => c.json(await disclose(deps, await c.req.json().catch(() => null))));

  // Demo only: each call costs one transaction per chain, so it is protected and rate-limited (ADR-018).
  app.post('/demo/flush', async (c) => {
    if (!deps.config.demo.enabled || !deps.config.demo.flushToken) throw new ApiError(404, 'not-found', 'not found');
    if (!sameSecret(c.req.header('x-demo-flush-token') ?? '', deps.config.demo.flushToken)) throw new ApiError(401, 'unauthorized', 'invalid flush token');
    const accepted = deps.config.chains.map((ch) => ch.chainId).filter((id) => deps.limiter.allow(`flush:${id}`, 1, 60));
    if (accepted.length === 0) throw new ApiError(429, 'rate-limited', 'flush allowed once per chain per minute');
    for (const id of accepted) deps.flushRequests.add(id);
    return c.json({ flushing: accepted }, 202);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  const devGateway = options.devGateway;
  if (devGateway) {
    app.get('/dev-gateway/:id', async (c) => {
      const bytes = await devGateway.get(c.req.param('id')).catch(() => null);
      if (!bytes) throw new ApiError(404, 'not-found', 'unknown item');
      return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'application/octet-stream' });
    });
  }

  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: error.code, message: error.message }, error.status);
    log.error('unhandled error', { path: c.req.path, error: error.message });
    return c.json({ error: 'internal', message: 'internal error' }, 500);
  });

  return app;
}
