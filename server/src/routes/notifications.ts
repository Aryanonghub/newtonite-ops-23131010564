import { Router } from 'express';
import { currentUser, requireAuth } from '../auth';
import { pool } from '../db';

export const notificationsRouter = Router();

// My latest notifications (written by the outbox worker).
notificationsRouter.get('/notifications', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const { rows } = await pool.query(
    'SELECT id, item_id, message, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 20',
    [user.id],
  );
  res.json({ notifications: rows });
});
