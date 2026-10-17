import { pool } from '../src/db';
import { migrate } from '../src/scripts/migrate';

// Runs once before all tests: bring the test database schema up to date.
export default async function () {
  await migrate();
  await pool.end();
}
