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

// THE permission check. Every endpoint uses it. It only looks at the user's role
// in the item's own team, so being a Lead in Payments gives no rights in Support.
export function can(user: AuthUser, action: Action, item: { team_id: number }): boolean {
  const role = user.roles[item.team_id];
  if (!role) return false;
  return RANK[role] >= RANK[MIN_ROLE[action]];
}

// Throwing version for route handlers.
// Not in the team at all -> 404, so outsiders cannot even learn the item exists.
// In the team but role too low -> 403 with a reason the UI can show.
export function authorize(user: AuthUser, action: Action, item: { team_id: number }): void {
  if (!user.roles[item.team_id]) throw new HttpError(404, 'Not found');
  if (!can(user, action, item)) {
    throw new HttpError(403, `Your role in this team (${user.roles[item.team_id]}) cannot ${action} items`);
  }
}

// Team ids where the user may read items. List queries filter by these.
export function readableTeamIds(user: AuthUser): number[] {
  return Object.keys(user.roles).map(Number);
}
