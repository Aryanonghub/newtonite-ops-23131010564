import {
  Avatar, Box, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PRIORITY_COLORS, STATUS_COLORS } from './theme';
import { label, timeAgo, type Item } from './types';

// Coloured dot + word. The word is always there, so colour is never the only signal.
export function PriorityChip({ priority }: { priority: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PRIORITY_COLORS[priority] ?? '#94a3b8' }} />
      <Typography variant="body2" sx={{ textTransform: 'capitalize', fontWeight: priority === 'urgent' ? 600 : 400 }}>
        {priority}
      </Typography>
    </Stack>
  );
}

// A tinted pill per status.
export function StatusChip({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.open;
  return (
    <Chip size="small" variant="outlined" label={label(status)} data-testid="status-chip"
      sx={{ color: c.fg, bgcolor: c.bg, borderColor: 'transparent', textTransform: 'capitalize' }} />
  );
}

// The same name always gets the same colour.
const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#2563eb', '#dc2626'];
function colorFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
// Demo names carry a role in brackets ("Priya (Payments Lead)"). Colour and initials use only the
// name itself, so the same person looks the same on the login page and inside the app.
export const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');
const initials = (name: string) => shortName(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function PersonAvatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.42, fontWeight: 600, bgcolor: colorFor(shortName(name)) }}>
      {initials(name)}
    </Avatar>
  );
}

// Avatar + name, or "Unassigned" for nobody. `short` drops the bracketed role (hover shows the full name).
export function Person({ name, short = false }: { name: string | null; short?: boolean }) {
  if (!name) return <Typography variant="body2" color="text.secondary">Unassigned</Typography>;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }} title={name}>
      <PersonAvatar name={name} />
      <Typography variant="body2" noWrap>{short ? shortName(name) : name}</Typography>
    </Stack>
  );
}

// Due dates in the past are red, unless the item is already done.
export function DueDate({ item }: { item: Item }) {
  if (!item.due_date) return <Typography variant="body2" color="text.secondary">—</Typography>;
  const overdue = item.due_date < new Date().toISOString().slice(0, 10) && !['resolved', 'closed'].includes(item.status);
  return (
    <Typography variant="body2" sx={{ color: overdue ? 'error.main' : 'text.primary', fontWeight: overdue ? 600 : 400 }}>
      {item.due_date}{overdue && ' · overdue'}
    </Typography>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-end' }, mb: 3 }}>
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="h5">{title}</Typography>
        {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
      </Box>
      {action}
    </Stack>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{text}</Typography>
    </Box>
  );
}

// The same table is used on the dashboard and the items page. Click a row to open the item.
export function ItemsTable({ items, empty = 'No items' }: { items: Item[]; empty?: string }) {
  const navigate = useNavigate();
  if (items.length === 0) return <EmptyState text={empty} />;
  return (
    <TableContainer>
      <Table size="small" sx={{ '& td, & th': { py: 1.25 } }}>
        <TableHead>
          <TableRow>
            <TableCell>Item</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Priority</TableCell>
            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Assignee</TableCell>
            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Due</TableCell>
            <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Updated</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/items/${item.id}`)}>
              <TableCell sx={{ maxWidth: 380 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{item.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  #{item.id} · {item.team_name} · {label(item.type)}
                </Typography>
              </TableCell>
              <TableCell><StatusChip status={item.status} /></TableCell>
              <TableCell><PriorityChip priority={item.priority} /></TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}><Person name={item.assignee_name} /></TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}><DueDate item={item} /></TableCell>
              <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
                <Tooltip title={new Date(item.updated_at).toLocaleString()}>
                  <Typography variant="body2" color="text.secondary">{timeAgo(item.updated_at)}</Typography>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
