import { Pool, type PoolClient, types } from 'pg';
import { config } from './config';

// Return DATE columns as plain 'YYYY-MM-DD' strings. The default turns them into
// JS Dates at local midnight, which can shift the day depending on the server's time zone.
types.setTypeParser(types.builtins.DATE, (value) => value);

// One shared connection pool for the whole process.
// Each request borrows a connection and gives it back when done.
export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

// Either the pool (auto-commit, one query) or a client inside a transaction.
export type Db = Pool | PoolClient;

// Runs fn inside one transaction on one connection.
// If fn throws (including our HttpErrors), everything it wrote is rolled back.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
