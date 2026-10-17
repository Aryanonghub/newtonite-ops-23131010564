import { Alert, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ItemsTable } from '../components';
import type { Item } from '../types';

// Must match LIMIT in server/src/routes/dashboard.ts. The server returns at most this many
// per panel and no total count, so a full panel means "there may be more", not "exactly 20".
const PANEL_LIMIT = 20;

interface Dashboard {
  assignedToMe: Item[];
  unassignedUrgent: Item[];
  awaitingMyApproval: Item[];
}

export function DashboardPage() {
  // Polling instead of websockets: refresh every 15 seconds (and when the tab regains focus).
  const { data, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
    refetchInterval: 15_000,
  });

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (!data) return <Typography>Loading…</Typography>;

  return (
    <Stack spacing={3}>
      <Panel title="Assigned to me" items={data.assignedToMe} empty="Nothing assigned to you" />
      <Panel title="Unassigned urgent" items={data.unassignedUrgent} empty="No unassigned urgent items" />
      <Panel title="Awaiting my approval" items={data.awaitingMyApproval} empty="Nothing waiting for your approval" />
    </Stack>
  );
}

function Panel({ title, items, empty }: { title: string; items: Item[]; empty: string }) {
  return (
    <Paper>
      <Typography variant="h6" sx={{ p: 2, pb: 0 }}>
        {title} ({items.length >= PANEL_LIMIT ? `top ${PANEL_LIMIT}` : items.length})
      </Typography>
      <ItemsTable items={items} empty={empty} />
    </Paper>
  );
}
