/**
 * Simple sequential SQL migration runner.
 *
 * Reads all *.sql files from the migrations directory in lexicographic order
 * and applies any that have not yet been recorded in the schema_migrations
 * tracking table. Idempotent — safe to run on every deploy.
 *
 * Usage:
 *   node --import tsx/esm packages/db/src/migrate.ts
 *   DATABASE_URL=... pnpm --filter @voai/db migrate
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

async function run(): Promise<void> {
  const url = process.env['MIGRATIONS_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('MIGRATIONS_DATABASE_URL or DATABASE_URL environment variable is required');
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Read applied versions
    const applied = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const appliedSet = new Set(applied.rows.map((r) => r.version));

    // Read all migration files
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    let applied_count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  apply ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied_count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${String(err)}`);
      }
    }

    console.log(
      `\nMigrations complete. ${applied_count} applied, ${appliedSet.size} already up to date.`,
    );
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
