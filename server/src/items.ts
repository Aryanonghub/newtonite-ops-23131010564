import { z } from 'zod';
import type { Db } from './db';
import { HttpError } from './errors';
import { STATUSES, type Status } from './workflow';

export const TYPES = ['incident', 'customer_issue', 'payment', 'compliance', 'task'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export interface Item {
  id: number;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: Status;
  team_id: number;
  team_name: string;
  assignee_id: number | null;
  assignee_name: string | null;
  created_by: number;
  created_by_name: string;
  due_date: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

// One shape for every item we return, with names joined in for the UI.
export const ITEM_SELECT = `
  SELECT w.id, w.title, w.description, w.type, w.priority, w.status,
         w.team_id, t.name AS team_name, w.assignee_id, a.name AS assignee_name,
         w.created_by, c.name AS created_by_name, w.due_date, w.version, w.created_at, w.updated_at
    FROM work_items w
    JOIN teams t ON t.id = w.team_id
    LEFT JOIN users a ON a.id = w.assignee_id
    JOIN users c ON c.id = w.created_by`;

export async function fetchItem(db: Db, id: number): Promise<Item | null> {
  const { rows } = await db.query(`${ITEM_SELECT} WHERE w.id = $1`, [id]);
  return rows[0] ?? null;
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found');
  return id;
}

// Validates input with a zod schema; turns problems into a readable 400.
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, message);
  }
  return result.data;
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const createItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(''),
  type: z.enum(TYPES),
  priority: z.enum(PRIORITIES),
  team_id: z.number().int().positive(),
  due_date: dateString.nullable().default(null),
});

// strictObject: unknown keys are rejected, so nobody can sneak in status or assignee_id.
// Those change only through /claim and /transition, where the workflow rules live.
export const patchItemSchema = z.strictObject({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  due_date: dateString.nullable().optional(),
});

export const transitionSchema = z.object({
  to: z.enum(STATUSES),
  version: z.number().int().positive(),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  type: z.enum(TYPES).optional(),
  team: z.coerce.number().int().positive().optional(),
  assignee: z.union([z.literal('me'), z.literal('none'), z.coerce.number().int().positive()]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// The cursor is just the id of the last item on the page, base64-encoded so clients treat it as opaque.
export const encodeCursor = (id: number) => Buffer.from(String(id)).toString('base64url');
export function decodeCursor(cursor: string): number {
  const id = Number(Buffer.from(cursor, 'base64url').toString());
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid cursor');
  return id;
}
