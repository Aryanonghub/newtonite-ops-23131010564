import express from 'express';
import { pool } from './db';

// Builds the Express app without starting it, so tests can use it with Supertest.
export function createApp() {
  const app = express();
  app.use(express.json());

  // Health check: proves the API is up and can reach Postgres.
  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  return app;
}
