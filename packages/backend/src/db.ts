import postgres from 'postgres';
import { MIGRATIONS } from './migrations.ts';

export type Sql = postgres.Sql;

export function connect(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 10, onnotice: () => {} });
}

/** Applies pending migrations in order, each in its own transaction. Safe to run on every start. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await sql<{ version: string }[]>`SELECT version FROM schema_migrations`).map((r) => r.version));
  const done: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`INSERT INTO schema_migrations (version) VALUES (${migration.version})`;
    });
    done.push(migration.version);
  }
  return done;
}
