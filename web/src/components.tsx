import {
  Avatar, Box, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PANEL_BG, PRIORITY_COLORS, STATUS_COLORS } from './theme';
import { label, type Item } from './types';

// Soft filled pill with the word, e.g. "High". Colour is never the only signal.
export function PriorityChip({ priority }: { priority: string }) {
  const c = PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.low;
  return (
    <Chip size="small" label={priority}
      sx={{ color: c.fg, bgcolor: c.bg, fontWeight: 600, textTransform: 'capitalize', minWidth: 72 }} />
  );
}

// Outlined uppercase pill per status. testId lets tests find the one on the item panel.
export function StatusChip({ status, testId = 'status-chip' }: { status: string; testId?: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.open;
  return (
    <Chip size="small" variant="outlined" label={label(status)} data-testid={testId}
      sx={{ color: c.fg, bgcolor: c.bg, borderColor: c.border, textTransform: 'uppercase', fontWeight: 600,
        fontSize: 11, letterSpacing: '0.03em' }} />
  );
}

// The same name always gets the same colour.
const AVATAR_COLORS = ['#1f5eff', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#7c3aed', '#0f766e', '#dc2626'];
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
      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{short ? shortName(name) : name}</Typography>
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

// "Dashboard / Work items" above the page title.
export function Breadcrumb({ parts }: { parts: ReactNode[] }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', fontSize: 14, mb: 1 }}>
      {parts.map((p, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {i > 0 && <span>/</span>}
          <Box component="span" sx={{ color: i === parts.length - 1 ? 'text.primary' : 'primary.main', fontWeight: 500 }}>{p}</Box>
        </Stack>
      ))}
    </Stack>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-end' }, mb: 3 }}>
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="h4" sx={{ fontSize: { xs: 26, md: 32 } }}>{title}</Typography>
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

// The same table is used on the dashboard and the items page. Click a row to open the item panel.
export function ItemsTable({ items, empty = 'No items', selectedId }: { items: Item[]; empty?: string; selectedId?: number }) {
  const navigate = useNavigate();
  if (items.length === 0) return <EmptyState text={empty} />;
  return (
    <TableContainer>
      <Table sx={{ '& td': { py: 1.5 } }}>
        <TableHead>
          <TableRow>
            <TableCell>Item ID</TableCell>
            <TableCell>Title</TableCell>
            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Team / Type</TableCell>
            <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Priority</TableCell>
            <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Due</TableCell>
            <TableCell align="center">Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} hover selected={item.id === selectedId} sx={{ cursor: 'pointer' }}
              onClick={() => navigate(`/items/${item.id}`)}>
              <TableCell sx={{ color: 'primary.main', fontWeight: 600, whiteSpace: 'nowrap' }}>#{item.id}</TableCell>
              <TableCell sx={{ maxWidth: 360 }}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                  {item.assignee_name
                    ? <Box title={item.assignee_name}><PersonAvatar name={item.assignee_name} size={26} /></Box>
                    : <Avatar sx={{ width: 26, height: 26, bgcolor: '#eef0f4', color: '#9aa1ac', fontSize: 13 }} title="Unassigned">–</Avatar>}
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{item.title}</Typography>
                </Stack>
              </TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, whiteSpace: 'nowrap' }}>
                <Typography variant="body2">{item.team_name} / <Box component="span" sx={{ color: 'text.secondary' }}>{label(item.type)}</Box></Typography>
              </TableCell>
              <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}><PriorityChip priority={item.priority} /></TableCell>
              <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, whiteSpace: 'nowrap' }}><DueDate item={item} /></TableCell>
              <TableCell align="center"><StatusChip status={item.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// Light panel with label/value pairs, two pairs per row on wide screens (like a spec sheet).
export function DetailGrid({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <Box sx={{ bgcolor: PANEL_BG, borderRadius: 2, p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3 }}>
        {rows.map(([name, value]) => (
          <Stack key={name} direction="row" sx={{ py: 1, borderBottom: '1px solid #e6e9ef', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ width: 110, flexShrink: 0 }}>{name}</Typography>
            <Box sx={{ minWidth: 0, fontSize: 14, fontWeight: 500 }}>{value}</Box>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}
