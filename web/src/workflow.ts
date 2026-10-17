import type { Me, Role, Status } from './types';

// A copy of the server's rules, used ONLY to decide which buttons to show.
// The server checks everything again; hiding a button is not security.
const RANK: Record<Role, number> = { viewer: 1, member: 2, lead: 3, admin: 4 };

export function roleIn(me: Me | undefined, teamId: number): Role | null {
  return me?.teams.find((t) => t.id === teamId)?.role ?? null;
}

export function atLeast(role: Role | null, min: Role): boolean {
  return role !== null && RANK[role] >= RANK[min];
}

// Buttons for each status: target status, label, and the minimum role needed.
export const ACTIONS: Record<Status, { to: Status; label: string; minRole: Role }[]> = {
  open: [], // uses the Claim button instead
  in_progress: [{ to: 'awaiting_approval', label: 'Submit for approval', minRole: 'member' }],
  awaiting_approval: [
    { to: 'resolved', label: 'Approve', minRole: 'lead' },
    { to: 'in_progress', label: 'Send back', minRole: 'member' },
  ],
  resolved: [
    { to: 'closed', label: 'Close', minRole: 'member' },
    { to: 'in_progress', label: 'Reopen', minRole: 'member' },
  ],
  closed: [],
};
