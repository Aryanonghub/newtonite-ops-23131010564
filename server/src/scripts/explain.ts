// Performance check: runs EXPLAIN (ANALYZE, BUFFERS) on the app's hot queries against the seeded
// database and prints, for each one, the execution time and which indexes Postgres actually used.
// Usage: npm run explain   (needs the seeded demo database; read-only, changes nothing)
import { pool } from '../db';
import { ITEM_SELECT } from '../items';

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

// Walks the plan tree and lists how each table was read, e.g. "Index Scan work_items_team_status_idx".
function scans(node: PlanNode, out: string[] = []): string[] {
  if (node['Index Name']) out.push(`${node['Node Type']} ${node['Index Name']}`);
  else if (node['Node Type'] === 'Seq Scan') out.push(`Seq Scan ${node['Relation Name']}`);
  for (const child of node.Plans ?? []) scans(child, out);
  return out;
}

async function explain(label: string, sql: string, params: unknown[]) {
  const { rows } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const result = rows[0]['QUERY PLAN'][0];
  const used = [...new Set(scans(result.Plan))].filter((s) => !s.includes('users') && !s.includes('teams'));
  console.log(`${result['Execution Time'].toFixed(2).padStart(8)} ms  ${label.padEnd(44)} ${used.join(', ')}`);
}

async function main() {
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM work_items');
  const user = async (email: string) => {
    const { rows } = await pool.query(
      'SELECT u.id, array_agg(m.team_id) AS teams FROM users u JOIN memberships m ON m.user_id = u.id WHERE email = $1 GROUP BY u.id',
      [email],
    );
    return rows[0] as { id: number; teams: number[] };
  };
  const priya = await user('priya@ops.test'); // Lead in one team
  const admin = await user('admin@ops.test'); // Admin in all four teams
  const { rows: [mid] } = await pool.query('SELECT id FROM work_items ORDER BY created_at DESC, id DESC OFFSET 500 LIMIT 1');
  console.log(`${n} work items. Times are server-side execution only (no network).\n`);

  for (const [who, u] of [['Lead, 1 team', priya], ['Admin, 4 teams', admin]] as const) {
    console.log(`-- ${who}`);
    const list = `${ITEM_SELECT} WHERE w.team_id = ANY($1)`;
    await explain('list: newest first, first page', `${list} ORDER BY w.created_at DESC, w.id DESC LIMIT 26`, [u.teams]);
    await explain('list: page after a cursor (row 500)', `${list} AND (w.created_at, w.id) < (SELECT created_at, id FROM work_items WHERE id = $2) ORDER BY w.created_at DESC, w.id DESC LIMIT 26`, [u.teams, mid.id]);
    await explain('list: status filter', `${list} AND w.status = 'awaiting_approval' ORDER BY w.created_at DESC, w.id DESC LIMIT 26`, [u.teams]);
    await explain('list: full-text search "refund"', `${list} AND (w.search_vector @@ websearch_to_tsquery('english', $2) OR w.title ILIKE $3) ORDER BY w.created_at DESC, w.id DESC LIMIT 26`, [u.teams, 'refund', '%refund%']);
    await explain('dashboard: assigned to me', `${ITEM_SELECT} WHERE w.assignee_id = $1 AND w.status IN ('in_progress', 'awaiting_approval') AND w.team_id = ANY($2) ORDER BY w.updated_at DESC LIMIT 20`, [u.id, u.teams]);
    await explain('dashboard: unassigned urgent', `${list} AND w.assignee_id IS NULL AND w.priority = 'urgent' ORDER BY w.created_at DESC LIMIT 20`, [u.teams]);
    await explain('stats: counts by status', 'SELECT status, count(*) FROM work_items WHERE team_id = ANY($1) GROUP BY status', [u.teams]);
    console.log();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
