import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool } from '../db';

export const DEMO_PASSWORD = 'password123';
const ITEM_COUNT = 20000;

type Role = 'viewer' | 'member' | 'lead' | 'admin';

const TEAMS = ['Payments', 'Support', 'Compliance', 'Platform'];

// Every role appears at least once. Sara and Vik are in two teams with roles there.
const USERS: { email: string; name: string; roles: Record<string, Role> }[] = [
  { email: 'admin@ops.test', name: 'Ada Admin',
    roles: { Payments: 'admin', Support: 'admin', Compliance: 'admin', Platform: 'admin' } },
  { email: 'priya@ops.test', name: 'Priya (Payments Lead)', roles: { Payments: 'lead' } },
  { email: 'mohan@ops.test', name: 'Mohan (Payments Member)', roles: { Payments: 'member' } },
  { email: 'sara@ops.test',  name: 'Sara (Payments + Support Member)', roles: { Payments: 'member', Support: 'member' } },
  { email: 'vik@ops.test',   name: 'Vik (Viewer)', roles: { Payments: 'viewer', Compliance: 'viewer' } },
  { email: 'lena@ops.test',  name: 'Lena (Support Lead)', roles: { Support: 'lead' } },
  { email: 'tom@ops.test',   name: 'Tom (Support Member)', roles: { Support: 'member' } },
  { email: 'carl@ops.test',  name: 'Carl (Compliance Lead)', roles: { Compliance: 'lead' } },
  { email: 'cara@ops.test',  name: 'Cara (Compliance Member)', roles: { Compliance: 'member' } },
  { email: 'omar@ops.test',  name: 'Omar (Platform Lead)', roles: { Platform: 'lead' } },
  { email: 'pia@ops.test',   name: 'Pia (Platform Member)', roles: { Platform: 'member' } },
];

const TYPES = ['incident', 'customer_issue', 'payment', 'compliance', 'task'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'];
const TITLES: Record<string, string[]> = {
  incident: ['API latency spike', 'Checkout errors rising', 'Webhook delivery failing'],
  customer_issue: ['Customer cannot log in', 'Customer charged twice', 'Statement missing'],
  payment: ['Refund failed for order', 'Card payment declined', 'Payout delayed for merchant'],
  compliance: ['KYC review needed', 'Sanctions screening hit', 'Audit evidence request'],
  task: ['Rotate API keys', 'Update runbook', 'Clean up stale accounts'],
};

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const HOUR = 60 * 60 * 1000;

export async function seed() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n > 0) {
      console.log('seed: data already present, skipping');
      return;
    }
    await client.query('BEGIN');
    await insertData(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertData(client: PoolClient) {
  // Hash once; all demo users share the same password.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const teamIds: Record<string, number> = {};
  for (const name of TEAMS) {
    const r = await client.query('INSERT INTO teams (name) VALUES ($1) RETURNING id', [name]);
    teamIds[name] = r.rows[0].id;
  }

  // For each team: who can work items, and who can approve them.
  const workers: Record<number, number[]> = {};
  const approvers: Record<number, number[]> = {};
  for (const id of Object.values(teamIds)) {
    workers[id] = [];
    approvers[id] = [];
  }

  for (const u of USERS) {
    const r = await client.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [u.email, u.name, passwordHash],
    );
    const userId = r.rows[0].id;
    for (const [teamName, role] of Object.entries(u.roles)) {
      const teamId = teamIds[teamName];
      await client.query('INSERT INTO memberships (user_id, team_id, role) VALUES ($1, $2, $3)', [userId, teamId, role]);
      if (role === 'member' || role === 'lead') workers[teamId].push(userId);
      if (role === 'lead' || role === 'admin') approvers[teamId].push(userId);
    }
  }

  // Build items and their history in memory, then bulk insert with unnest() (one query per table).
  const items = { id: [] as number[], title: [] as string[], description: [] as string[], type: [] as string[],
    priority: [] as string[], status: [] as string[], team_id: [] as number[], assignee_id: [] as (number | null)[],
    created_by: [] as number[], submitted_by: [] as (number | null)[], due_date: [] as (string | null)[], version: [] as number[],
    created_at: [] as string[], updated_at: [] as string[] };
  const events = { item_id: [] as number[], actor_id: [] as number[], kind: [] as string[],
    from_value: [] as (string | null)[], to_value: [] as (string | null)[], created_at: [] as string[] };

  const addEvent = (itemId: number, actor: number, kind: string, from: string | null, to: string | null, at: number) => {
    events.item_id.push(itemId); events.actor_id.push(actor); events.kind.push(kind);
    events.from_value.push(from); events.to_value.push(to); events.created_at.push(new Date(at).toISOString());
  };

  for (let id = 1; id <= ITEM_COUNT; id++) {
    const teamId = pick(Object.values(teamIds));
    const type = pick(TYPES);
    const creator = pick(workers[teamId]);
    const finalStatus = Math.floor(Math.random() * STATUSES.length);
    let t = Date.now() - Math.random() * 90 * 24 * HOUR; // created in the last 90 days
    const createdAt = t;

    addEvent(id, creator, 'created', null, 'open', t);
    let version = 1;
    let assignee: number | null = null;

    // Walk the workflow from "open" up to the chosen status, recording each step.
    for (let s = 1; s <= finalStatus; s++) {
      t += Math.random() * 24 * HOUR;
      let actor: number;
      if (s === 1) {
        // Claim: sets assignee and moves to in_progress in one update.
        assignee = pick(workers[teamId]);
        actor = assignee;
        addEvent(id, actor, 'assignee_changed', null, String(assignee), t);
      } else if (STATUSES[s] === 'resolved') {
        // Only Lead/Admin may approve, and never the one who submitted (four-eyes).
        // The Admin is in every team, so there is always someone else.
        actor = pick(approvers[teamId].filter((a) => a !== assignee));
      } else {
        actor = assignee!;
      }
      addEvent(id, actor, 'status_changed', STATUSES[s - 1], STATUSES[s], t);
      version++;
    }

    items.id.push(id);
    items.title.push(`${pick(TITLES[type])} #${1000 + id}`);
    items.description.push(`Seeded ${type.replace('_', ' ')} for demo purposes.`);
    items.type.push(type);
    items.priority.push(pick(PRIORITIES));
    items.status.push(STATUSES[finalStatus]);
    items.team_id.push(teamId);
    items.assignee_id.push(assignee);
    items.created_by.push(creator);
    items.submitted_by.push(STATUSES[finalStatus] === 'awaiting_approval' ? assignee : null);
    items.due_date.push(Math.random() < 0.5 ? new Date(createdAt + (1 + Math.random() * 14) * 24 * HOUR).toISOString().slice(0, 10) : null);
    items.version.push(version);
    items.created_at.push(new Date(createdAt).toISOString());
    items.updated_at.push(new Date(t).toISOString());
  }

  await client.query(
    `INSERT INTO work_items (id, title, description, type, priority, status, team_id, assignee_id,
                             created_by, submitted_by, due_date, version, created_at, updated_at)
     SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[],
                          $8::int[], $9::int[], $10::int[], $11::date[], $12::int[], $13::timestamptz[], $14::timestamptz[])`,
    [items.id, items.title, items.description, items.type, items.priority, items.status, items.team_id,
      items.assignee_id, items.created_by, items.submitted_by, items.due_date, items.version, items.created_at,
      items.updated_at],
  );
  // We inserted explicit ids, so move the id counter past them for future inserts.
  await client.query(`SELECT setval(pg_get_serial_sequence('work_items', 'id'), (SELECT max(id) FROM work_items))`);

  await client.query(
    `INSERT INTO activity_events (item_id, actor_id, kind, from_value, to_value, created_at)
     SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])`,
    [events.item_id, events.actor_id, events.kind, events.from_value, events.to_value, events.created_at],
  );

  console.log(`seed: ${TEAMS.length} teams, ${USERS.length} users, ${ITEM_COUNT} items, ${events.item_id.length} events`);
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
