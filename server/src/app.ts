import express from 'express';
import { pool } from './db';
import { errorHandler } from './errors';
import { authRouter } from './routes/auth';
import { dashboardRouter } from './routes/dashboard';
import { itemsRouter } from './routes/items';
import { notificationsRouter } from './routes/notifications';

// Builds the Express app without starting it, so tests can use it with Supertest.
export function createApp() {
  const app = express();
  app.use(express.json());

  // Health check: proves the API is up and can reach Postgres.
  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use(authRouter);
  app.use(dashboardRouter);
  app.use(notificationsRouter);
  app.use('/items', itemsRouter);

  app.use(errorHandler); // must be registered last
  return app;
}
