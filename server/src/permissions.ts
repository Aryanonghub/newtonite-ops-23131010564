import { HttpError } from './errors';

export type Role = 'viewer' | 'member' | 'lead' | 'admin';
export type Action = 'read' | 'comment' | 'create' | 'edit' | 'claim' | 'transition' | 'approve';

// The logged-in user, with their role in each team (team_id -> role).
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  roles: Record<number, Role>;
}

// Roles are ordered: each one can do everything the roles below it can.
const RANK: Record<Role, number> = { viewer: 1, member: 2, lead: 3, admin: 4 };

// The lowest role in the item's team that is allowed to do each action.
const MIN_ROLE: Record<Action, Role> = {
  read: 'viewer',
  comment: 'member',
  create: 'member',
  edit: 'member',
  claim: 'member',
  transition: 'member',
  approve: 'lead', // Awaiting Approval -> Resolved
};

// What can() needs to know about an item. submitted_by matters only for 'approve',
// assignee_id only for 'transition'.
type PermissionItem = { team_id: number; submitted_by?: number | null; assignee_id?: number | null };

// THE permission check. Every endpoint uses it. It only looks at the user's role
// in the item's own team, so being a Lead in Payments gives no rights in Support.
// Two item-level rules also live here, so this stays the one place to look:
// - Four-eyes: whoever submitted an item for approval cannot approve it, whatever their role.
// - Ownership: once an item has an assignee, only they (or a Lead/Admin) can move it through the
//   workflow, so the history shows who actually did the work. Open items have no assignee yet;
//   for those the workflow's own answer applies ("claim the item to start work").
export function can(user: AuthUser, action: Action, item: PermissionItem): boolean {
  const role = user.roles[item.team_id];
  if (!role) return false;
  if (action === 'approve' && item.submitted_by === user.id) return false;
  if (action === 'transition' && isSomeoneElsesItem(user, role, item)) return false;
  return RANK[role] >= RANK[MIN_ROLE[action]];
}

// A Member trying to move an item that is assigned to someone else. (Viewers can't move anything
// anyway, and Leads/Admins may move any item in their team, e.g. to cover for someone away.)
function isSomeoneElsesItem(user: AuthUser, role: Role, item: PermissionItem): boolean {
  return role === 'member' && item.assignee_id != null && item.assignee_id !== user.id;
}

// Throwing version for route handlers.
// Not in the team at all -> 404, so outsiders cannot even learn the item exists.
// In the team but not allowed -> 403 with a reason the UI can show.
export function authorize(user: AuthUser, action: Action, item: PermissionItem): void {
  if (!user.roles[item.team_id]) throw new HttpError(404, 'Not found');
  if (!can(user, action, item)) {
    if (action === 'approve' && item.submitted_by === user.id) {
      throw new HttpError(403, 'You submitted this item for approval, so someone else must approve it');
    }
    const role = user.roles[item.team_id];
    if (action === 'transition' && isSomeoneElsesItem(user, role, item)) {
      throw new HttpError(403, 'Only the assignee or a Lead can move this item');
    }
    throw new HttpError(403, `Your role in this team (${user.roles[item.team_id]}) cannot ${action} items`);
  }
}

// Team ids where the user may read items. List queries filter by these.
export function readableTeamIds(user: AuthUser): number[] {
  return Object.keys(user.roles).map(Number);
}
