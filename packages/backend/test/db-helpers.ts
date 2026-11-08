import { inject } from 'vitest';
import postgres from 'postgres';
import { connect, migrate, type Sql } from '../src/db.ts';

/** Creates an isolated, migrated database for one test file. */
export async function freshDatabase(): Promise<{ sql: Sql; url: string }> {
  const adminUrl = inject('databaseUrl');
  const name = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const sql = connect(url);
  await migrate(sql);
  return { sql, url };
}
