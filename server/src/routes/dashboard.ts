import { Router } from 'express';
import { currentUser, requireAuth } from '../auth';
import { pool } from '../db';
import { ITEM_SELECT } from '../items';
import { readableTeamIds } from '../permissions';

export const dashboardRouter = Router();

const LIMIT = 20; // each panel shows the top items; the full list page has pagination

dashboardRouter.get('/dashboard', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const teams = readableTeamIds(user);
  const approverTeams = teams.filter((t) => user.roles[t] === 'lead' || user.roles[t] === 'admin');

  // Three independent read queries, run in parallel. Each one matches an index.
  const [assignedToMe, unassignedUrgent, awaitingMyApproval] = await Promise.all([
    pool.query(
      `${ITEM_SELECT} WHERE w.assignee_id = $1 AND w.status IN ('in_progress', 'awaiting_approval')
        AND w.team_id = ANY($2) ORDER BY w.updated_at DESC LIMIT ${LIMIT}`,
      [user.id, teams],
    ),
    pool.query(
      `${ITEM_SELECT} WHERE w.team_id = ANY($1) AND w.assignee_id IS NULL AND w.priority = 'urgent'
        ORDER BY w.created_at DESC LIMIT ${LIMIT}`,
      [teams],
    ),
    pool.query(
      // Not my own submissions: the four-eyes rule means someone else has to approve those.
      `${ITEM_SELECT} WHERE w.team_id = ANY($1) AND w.status = 'awaiting_approval' AND w.submitted_by <> $2
        ORDER BY w.updated_at ASC LIMIT ${LIMIT}`, // oldest first: they have waited longest
      [approverTeams, user.id],
    ),
  ]);

  res.json({
    assignedToMe: assignedToMe.rows,
    unassignedUrgent: unassignedUrgent.rows,
    awaitingMyApproval: awaitingMyApproval.rows,
  });
});
