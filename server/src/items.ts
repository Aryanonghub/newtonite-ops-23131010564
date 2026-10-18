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
  submitted_by: number | null; // who moved it to Awaiting Approval (set only in that status)
  submitted_by_name: string | null;
  due_date: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

// One shape for every item we return, with names joined in for the UI.
export const ITEM_SELECT = `
  SELECT w.id, w.title, w.description, w.type, w.priority, w.status,
         w.team_id, t.name AS team_name, w.assignee_id, a.name AS assignee_name,
         w.created_by, c.name AS created_by_name, w.submitted_by, s.name AS submitted_by_name,
         w.due_date, w.version, w.created_at, w.updated_at
    FROM work_items w
    JOIN teams t ON t.id = w.team_id
    LEFT JOIN users a ON a.id = w.assignee_id
    JOIN users c ON c.id = w.created_by
    LEFT JOIN users s ON s.id = w.submitted_by`;

export async function fetchItem(db: Db, id: number): Promise<Item | null> {
  const { rows } = await db.query(`${ITEM_SELECT} WHERE w.id = $1`, [id]);
  return rows[0] ?? null;
}

// Ids and versions are Postgres INT columns. A bigger number would make Postgres raise an error (a 500),
// so it is rejected here instead: as 404 for a path id, as 400 for query and body values.
const MAX_INT = 2_147_483_647;
const isId = (n: number) => Number.isInteger(n) && n > 0 && n <= MAX_INT;
const positiveInt = z.number().int().positive().max(MAX_INT);
const positiveIntParam = z.coerce.number().int().positive().max(MAX_INT); // from a query string

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!isId(id)) throw new HttpError(404, 'Not found');
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

// YYYY-MM-DD and a real calendar date (2026-02-30 would otherwise reach Postgres and fail there).
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((d) => {
    const date = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(d); // 2026-02-30 rolls over to March
  }, 'is not a real date');

export const createItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(''),
  type: z.enum(TYPES),
  priority: z.enum(PRIORITIES),
  team_id: positiveInt,
  due_date: dateString.nullable().default(null),
});

// strictObject: unknown keys are rejected, so nobody can sneak in status or assignee_id.
// Those change only through /claim and /transition, where the workflow rules live.
export const patchItemSchema = z.strictObject({
  version: positiveInt,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  due_date: dateString.nullable().optional(),
});

export const transitionSchema = z.object({
  to: z.enum(STATUSES),
  version: positiveInt,
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  type: z.enum(TYPES).optional(),
  team: positiveIntParam.optional(),
  assignee: z.union([z.literal('me'), z.literal('none'), positiveIntParam]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// The cursor is just the id of the last item on the page, base64-encoded so clients treat it as opaque.
export const encodeCursor = (id: number) => Buffer.from(String(id)).toString('base64url');
export function decodeCursor(cursor: string): number {
  const id = Number(Buffer.from(cursor, 'base64url').toString());
  if (!isId(id)) throw new HttpError(400, 'Invalid cursor');
  return id;
}
