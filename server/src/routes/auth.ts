import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { currentUser, requireAuth, signToken } from '../auth';
import { pool } from '../db';
import { HttpError } from '../errors';

export const authRouter = Router();

// Compared against when the email is unknown, so both failure cases take the same time
// and an attacker cannot tell which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// Rate limit: after MAX_FAILURES wrong passwords for one email within the window, refuse further
// attempts (even correct ones) with 429 until the oldest failure leaves the window. Counted per email,
// so guessing one account's password is slowed down without locking anyone else out.
export const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

authRouter.post('/auth/login', async (req, res) => {
  const { email: rawEmail, password } = req.body ?? {};
  if (typeof rawEmail !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'email and password are required');
  }
  const email = rawEmail.toLowerCase();

  const recent = await pool.query(
    `SELECT count(*)::int AS n, min(created_at) AS oldest FROM login_failures
      WHERE email = $1 AND created_at > now() - make_interval(mins => $2)`,
    [email, WINDOW_MINUTES],
  );
  if (recent.rows[0].n >= MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil(
      (new Date(recent.rows[0].oldest).getTime() + WINDOW_MINUTES * 60_000 - Date.now()) / 1000,
    ));
    res.setHeader('Retry-After', String(retryAfter));
    throw new HttpError(429, `Too many failed logins. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`);
  }

  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  const ok = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_HASH);
  if (rows.length === 0 || !ok) {
    await pool.query('INSERT INTO login_failures (email) VALUES ($1)', [email]);
    throw new HttpError(401, 'Invalid email or password'); // same message for both
  }

  await pool.query('DELETE FROM login_failures WHERE email = $1', [email]); // a success resets the count
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
