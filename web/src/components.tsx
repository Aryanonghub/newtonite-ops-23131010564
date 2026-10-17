import {
  Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { useNavigate } from 'react-router';
import { label, type Item } from './types';

const PRIORITY_COLOR = { urgent: 'error', high: 'warning', medium: 'info', low: 'default' } as const;

export function PriorityChip({ priority }: { priority: string }) {
  const color = PRIORITY_COLOR[priority as keyof typeof PRIORITY_COLOR] ?? 'default';
  return <Chip size="small" color={color} label={priority} />;
}

export function StatusChip({ status }: { status: string }) {
  return <Chip size="small" variant="outlined" label={label(status)} />;
}

// The same table is used on the dashboard and the items page. Click a row to open the item.
export function ItemsTable({ items, empty = 'No items' }: { items: Item[]; empty?: string }) {
  const navigate = useNavigate();
  if (items.length === 0) return <Typography color="text.secondary" sx={{ p: 2 }}>{empty}</Typography>;
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Priority</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Team</TableCell>
            <TableCell>Assignee</TableCell>
            <TableCell>Due</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/items/${item.id}`)}>
              <TableCell>{item.id}</TableCell>
              <TableCell>{item.title}</TableCell>
              <TableCell><PriorityChip priority={item.priority} /></TableCell>
              <TableCell><StatusChip status={item.status} /></TableCell>
              <TableCell>{item.team_name}</TableCell>
              <TableCell>{item.assignee_name ?? '—'}</TableCell>
              <TableCell>{item.due_date ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
