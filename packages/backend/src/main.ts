import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app.ts';
import { chainContext } from './chains.ts';
import { loadConfig } from './config.ts';
import { connect, migrate } from './db.ts';
import type { Deps } from './deps.ts';
import { simulatorKeyStore } from './keys.ts';
import { log } from './log.ts';
import { RateLimiter } from './rate-limit.ts';
import { startWorkers } from './runner.ts';
import { MemoryStorage, turboStorage } from './storage.ts';

/** Single process for the PoC: API + workers (ADR-016). */
async function main() {
  const config = loadConfig(process.env);
  const sql = connect(config.databaseUrl);
  const applied = await migrate(sql);
  if (applied.length) log.info('migrations applied', { versions: applied.join(',') });

  const { keyStore, created } = simulatorKeyStore(config.keystorePath, config.keyRefs);
  const relayer = keyStore.evmAccount(config.keyRefs.relayer);
  // The logger redacts every address; the public relayer and receipt addresses for config/trusted-keys.json come from print-keys.
  log.info(created ? 'KMS simulator keystore created' : 'KMS simulator keystore loaded', { hint: 'run node dist/print-keys.js to print the public relayer and receipt addresses' });

  const now = () => Math.floor(Date.now() / 1000);
  const deps: Deps = { sql, config, keyStore, now, limiter: new RateLimiter(now), flushRequests: new Set() };
  const storage = config.storageMode === 'turbo' ? turboStorage(keyStore.arweaveJwk(config.keyRefs.arweave)) : new MemoryStorage();
  if (config.storageMode === 'memory') log.warn('STORAGE_MODE=memory: uploads are kept in memory and lost on restart');

  const chains = config.chains.map((c) => chainContext(c, relayer));
  const workers = startWorkers(deps, storage, chains);
  const app = createApp(deps, (c) => getConnInfo(c).remote.address ?? 'unknown', { devGateway: storage instanceof MemoryStorage ? storage : undefined });
  const server = serve({ fetch: app.fetch, port: config.port });
  log.info('backend started', { port: config.port, chains: config.chains.map((c) => c.chainId).join(','), demo: config.demo.enabled });

  const shutdown = async () => {
    server.close();
    await workers.stop();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log.error('backend failed to start', { error: (error as Error).message });
  process.exit(1);
});
