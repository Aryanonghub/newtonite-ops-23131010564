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

// Buttons for each status: target status, label, minimum role, and the success message.
export const ACTIONS: Record<Status, { to: Status; label: string; minRole: Role; done: string }[]> = {
  open: [], // uses the Claim button instead
  in_progress: [{ to: 'awaiting_approval', label: 'Submit for approval', minRole: 'member', done: 'Submitted for approval' }],
  awaiting_approval: [
    { to: 'resolved', label: 'Approve', minRole: 'lead', done: 'Approved' },
    { to: 'in_progress', label: 'Send back', minRole: 'member', done: 'Sent back for more work' },
  ],
  resolved: [
    { to: 'closed', label: 'Close', minRole: 'member', done: 'Closed' },
    { to: 'in_progress', label: 'Reopen', minRole: 'member', done: 'Reopened' },
  ],
  closed: [],
};

// Ownership: once an item is assigned, only the assignee or a Lead/Admin can move it.
export function canMove(role: Role | null, assigneeId: number | null, meId: number): boolean {
  if (!atLeast(role, 'member')) return false;
  return atLeast(role, 'lead') || assigneeId === null || assigneeId === meId;
}

// Four-eyes: whoever submitted an item for approval cannot approve it.
export function canApprove(role: Role | null, submittedByMe: boolean): boolean {
  return atLeast(role, 'lead') && !submittedByMe;
}

// One sentence under the buttons telling the user what happens next, from their point of view.
export function nextStep(status: Status, role: Role | null, teamName: string, submittedByMe: boolean): string {
  if (!atLeast(role, 'member')) return 'You have read-only access in this team.';
  switch (status) {
    case 'open': return 'Claim this item to start working on it.';
    case 'in_progress': return 'When the work is done, submit it for approval.';
    case 'awaiting_approval':
      if (submittedByMe) return `You submitted this, so another Lead of ${teamName} must approve it.`;
      return atLeast(role, 'lead')
        ? 'Review the work, then approve it or send it back.'
        : `Waiting for a Lead of ${teamName} to approve.`;
    case 'resolved': return 'Close it, or reopen it if more work is needed.';
    case 'closed': return 'This item is closed.';
  }
}
