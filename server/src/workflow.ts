import { HttpError } from './errors';
import { authorize, type AuthUser } from './permissions';

export const STATUSES = ['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

// Every allowed move. Anything not listed here is rejected by the server.
const TRANSITIONS: Record<Status, Status[]> = {
  open: [],                                       // leaves Open only via POST /items/:id/claim
  in_progress: ['awaiting_approval'],
  awaiting_approval: ['resolved', 'in_progress'], // approve, or send back for more work
  resolved: ['closed', 'in_progress'],            // close, or reopen
  closed: [],                                     // final
};

export function isApproval(from: Status, to: Status): boolean {
  return from === 'awaiting_approval' && to === 'resolved';
}

// Throws 422 for a move that is not in the map, and 403 if a non-Lead tries to approve.
export function checkTransition(user: AuthUser, item: { status: Status; team_id: number }, to: Status) {
  if (!TRANSITIONS[item.status].includes(to)) {
    const hint = item.status === 'open' ? ' (claim the item to start work)' : '';
    throw new HttpError(422, `Cannot move from ${item.status} to ${to}${hint}`);
  }
  if (isApproval(item.status, to)) authorize(user, 'approve', item);
}
