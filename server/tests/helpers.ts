import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/app';
import { signToken } from '../src/auth';
import { pool } from '../src/db';
import type { Role } from '../src/permissions';

export const app = createApp();
export const api = () => request(app);
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Low bcrypt cost: tests stay fast. (Real users are hashed with cost 10.)
const PASSWORD_HASH = bcrypt.hashSync('password123', 4);

// Empties every table. Refuses to run against anything that isn't a *_test database.
export async function resetDb() {
  const { rows } = await pool.query('SELECT current_database() AS db');
  if (!rows[0].db.endsWith('_test')) throw new Error(`Refusing to wipe non-test database "${rows[0].db}"`);
  // TRUNCATE does not fire row triggers, so it can clear the append-only activity table.
  await pool.query(`TRUNCATE users, teams, memberships, work_items, comments, activity_events,
                    idempotency_keys, outbox_jobs, notifications RESTART IDENTITY CASCADE`);
}

export interface TestUser {
  id: number;
  token: string;
}

// A small, known world for every test:
//   Payments: alice (member), bob (member), lee (lead), ada (admin), vic (viewer)
//   Support:  sam (member)  <- the "other team" user
export async function seedFixture() {
  await resetDb();
  const team = async (name: string): Promise<number> =>
    (await pool.query('INSERT INTO teams (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
  const payments = await team('Payments');
  const support = await team('Support');

  const user = async (name: string, teamId: number, role: Role): Promise<TestUser> => {
    const { rows } = await pool.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [`${name}@test.local`, name, PASSWORD_HASH],
    );
    await pool.query('INSERT INTO memberships (user_id, team_id, role) VALUES ($1, $2, $3)', [rows[0].id, teamId, role]);
    return { id: rows[0].id, token: signToken(rows[0].id) };
  };

  return {
    payments,
    support,
    alice: await user('alice', payments, 'member'),
    bob: await user('bob', payments, 'member'),
    lee: await user('lee', payments, 'lead'),
    ada: await user('ada', payments, 'admin'),
    vic: await user('vic', payments, 'viewer'),
    sam: await user('sam', support, 'member'),
  };
}
export type Fixture = Awaited<ReturnType<typeof seedFixture>>;

// Creates an item through the real API (so the 'created' event is written too).
export async function createItem(user: TestUser, teamId: number, fields: Record<string, unknown> = {}) {
  const res = await api()
    .post('/items')
    .set(auth(user.token))
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ title: 'Test item', type: 'task', priority: 'high', team_id: teamId, ...fields });
  expect(res.status).toBe(201);
  return res.body;
}

// Reads the row straight from the database, bypassing the API.
export async function dbItem(id: number) {
  const { rows } = await pool.query('SELECT * FROM work_items WHERE id = $1', [id]);
  return rows[0];
}

export async function dbEvents(itemId: number) {
  const { rows } = await pool.query(
    'SELECT kind, field, from_value, to_value, actor_id FROM activity_events WHERE item_id = $1 ORDER BY id',
    [itemId],
  );
  return rows;
}
