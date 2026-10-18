import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from '../App';
import { ItemsTable, PageHeader } from '../components';
import type { Item } from '../types';

// Must match LIMIT in server/src/routes/dashboard.ts. The server returns at most this many
// per panel and no total count, so a full panel means "there may be more", not "exactly 20".
const PANEL_LIMIT = 20;

interface Dashboard {
  assignedToMe: Item[];
  unassignedUrgent: Item[];
  awaitingMyApproval: Item[];
}

const count = (items: Item[]) => (items.length >= PANEL_LIMIT ? `${PANEL_LIMIT}+` : String(items.length));

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const { data: me } = useMe();
  // Polling instead of websockets: refresh every 15 seconds (and when the tab regains focus).
  const { data, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
    refetchInterval: 15_000,
  });

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (!data) return <Typography>Loading…</Typography>;

  const firstName = me?.name.split(/[\s(]/)[0];
  const panels = [
    { title: 'Assigned to me', items: data.assignedToMe, empty: 'Nothing assigned to you', hint: 'In progress or waiting on approval', accent: '#1f5eff' },
    { title: 'Unassigned urgent', items: data.unassignedUrgent, empty: 'No unassigned urgent items', hint: 'Needs someone to claim it', accent: '#dc2626' },
    { title: 'Awaiting my approval', items: data.awaitingMyApproval, empty: 'Nothing waiting for your approval', hint: 'Submitted by someone else', accent: '#c2410c' },
  ];

  return (
    <>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ''}`} subtitle="Here is what needs you today." />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 4 }}>
        {panels.map((p) => (
          <Paper key={p.title} sx={{ p: 2.5, borderTop: `3px solid ${p.accent}` }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>{p.title}</Typography>
            <Typography sx={{ fontSize: 34, fontWeight: 700, lineHeight: 1.2, mt: 0.5 }}>{count(p.items)}</Typography>
            <Typography variant="caption" color="text.secondary">{p.hint}</Typography>
          </Paper>
        ))}
      </Box>

      <Stack spacing={3}>
        {panels.map((p) => (
          <Paper key={p.title}>
            <Stack direction="row" sx={{ alignItems: 'center', px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.accent, mr: 1.25 }} />
              <Typography variant="h6" sx={{ fontSize: 16, flexGrow: 1 }}>{p.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {p.items.length >= PANEL_LIMIT ? `top ${PANEL_LIMIT}` : p.items.length}
              </Typography>
            </Stack>
            <ItemsTable items={p.items} empty={p.empty} />
          </Paper>
        ))}
      </Stack>
    </>
  );
}
