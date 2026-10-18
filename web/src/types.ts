export type Status = 'open' | 'in_progress' | 'awaiting_approval' | 'resolved' | 'closed';
export type Role = 'viewer' | 'member' | 'lead' | 'admin';

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
  submitted_by: number | null;
  submitted_by_name: string | null;
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ItemPage {
  items: Item[];
  nextCursor: string | null;
}

export interface Me {
  id: number;
  email: string;
  name: string;
  teams: { id: number; name: string; role: Role }[];
}

export interface ActivityEvent {
  id: number;
  kind: string;
  field: string | null;
  from_value: string | null;
  to_value: string | null;
  to_name: string | null;
  comment: string | null;
  actor_name: string;
  created_at: string;
}

export const STATUSES: Status[] = ['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TYPES = ['incident', 'customer_issue', 'payment', 'compliance', 'task'];

export const label = (value: string) => value.replace(/_/g, ' ');

// "just now", "5 minutes ago", "3 days ago"
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}
