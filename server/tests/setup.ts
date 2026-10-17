import { afterAll } from 'vitest';
import { pool } from '../src/db';

// Close DB connections after each test file so the process can exit cleanly.
afterAll(async () => {
  await pool.end();
});
