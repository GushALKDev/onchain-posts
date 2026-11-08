import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const POSTGRES_IMAGE = 'postgres:17';
let containerId: string | undefined;

/** Builds the contracts and starts a throwaway Postgres container for the whole run. */
export async function setup(project: TestProject) {
  execFileSync('forge', ['build'], { cwd: fileURLToPath(new URL('../../../contracts', import.meta.url)), stdio: 'ignore' });
  containerId = execFileSync('docker', ['run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=phi', '-p', '127.0.0.1::5432', POSTGRES_IMAGE], { encoding: 'utf8' }).trim();
  const port = execFileSync('docker', ['port', containerId, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0]!.split(':').pop();
  const url = `postgres://postgres:phi@127.0.0.1:${port}/postgres`;

  // During initialisation the image runs a temporary server on the Unix socket only, then restarts with TCP; a TCP
  // pg_isready inside the container therefore passes only once the final server is up. Retry a few times regardless.
  let ready = 0;
  for (let i = 0; i < 120 && ready < 3; i++) {
    try {
      execFileSync('docker', ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' });
      ready++;
    } catch {
      ready = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (ready < 3) throw new Error('Postgres container did not become ready');
  project.provide('databaseUrl', url);
}

export function teardown() {
  if (containerId) execFileSync('docker', ['stop', containerId], { stdio: 'ignore' });
}
