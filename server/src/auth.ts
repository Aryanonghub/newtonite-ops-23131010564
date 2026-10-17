import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { pool } from './db';
import { HttpError } from './errors';
import type { AuthUser, Role } from './permissions';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: number): string {
  // The token only says WHO you are. Roles are loaded fresh from the DB on every request,
  // so removing someone from a team takes effect immediately, not when their token expires.
  return jwt.sign({}, config.jwtSecret, { subject: String(userId), expiresIn: '8h', algorithm: 'HS256' });
}

// Loads the user and their per-team roles in one query.
export async function loadUser(userId: number): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, m.team_id, m.role
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const roles: Record<number, Role> = {};
  for (const r of rows) if (r.team_id !== null) roles[r.team_id] = r.role;
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name, roles };
}

// Middleware: requires "Authorization: Bearer <token>" and sets req.user.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Missing bearer token');

  let userId: number;
  try {
    // Pin the algorithm so a forged token cannot pick a weaker one.
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    userId = Number(payload.sub);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const user = await loadUser(userId);
  if (!user) throw new HttpError(401, 'User no longer exists');
  req.user = user;
  next();
};

// Use inside handlers that sit behind requireAuth.
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  return req.user;
}
