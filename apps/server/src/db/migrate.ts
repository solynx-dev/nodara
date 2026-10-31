import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './index.js';

function migrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, 'migrations'), join(here, 'db', 'migrations'), join(here, '..', 'src', 'db', 'migrations')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Could not locate migrations directory (set MIGRATIONS_DIR).');
}

/**
 * Applies pending SQL migrations in filename order. Each migration runs in its
 * own transaction; an advisory lock prevents concurrent runners.
 */
export async function migrate(sql: Sql, log: (msg: string) => void = () => {}): Promise<string[]> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(727274)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(join(dir, file), 'utf8');
      log(`Applying migration ${file}`);
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
  });
  return applied;
}
