import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { currentUser, requireAuth, signToken } from '../auth';
import { pool } from '../db';
import { HttpError } from '../errors';

export const authRouter = Router();

// Compared against when the email is unknown, so both failure cases take the same time
// and an attacker cannot tell which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

authRouter.post('/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'email and password are required');
  }

  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email.toLowerCase()]);
  const ok = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_HASH);
  if (rows.length === 0 || !ok) throw new HttpError(401, 'Invalid email or password'); // same message for both

  res.json({ token: signToken(rows[0].id) });
});

// Who am I, and what is my role in each team? The UI uses this to show/hide buttons.
// (The server still checks every action; hiding a button is not security.)
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const { rows } = await pool.query(
    `SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = $1 ORDER BY t.name`,
    [user.id],
  );
  res.json({ id: user.id, email: user.email, name: user.name, teams: rows });
});
