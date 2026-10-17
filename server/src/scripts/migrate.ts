import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { pool } from '../db';

// Same relative path works from src/scripts (tsx) and dist/scripts (compiled).
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');
const LOCK_ID = 727001; // any fixed number; used for the advisory lock below

// Applies every .sql file in migrations/ that has not been applied yet, in name order.
export async function migrate(db: Pool = pool) {
  const client = await db.connect();
  try {
    // If two containers start at once, only one runs migrations; the other waits.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // Each migration runs in its own transaction: it fully applies or not at all.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`migrated: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
