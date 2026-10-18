import AddRounded from '@mui/icons-material/AddRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import AutorenewRounded from '@mui/icons-material/AutorenewRounded';
import {
  Alert, Badge, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, InputAdornment, MenuItem,
  Paper, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, newIdempotencyKey } from '../api';
import { useMe } from '../App';
import { Breadcrumb, ItemsTable, PageHeader } from '../components';
import { STATUS_COLORS } from '../theme';
import { PRIORITIES, STATUSES, TYPES, label, type Item, type ItemPage } from '../types';
import { atLeast } from '../workflow';
import { ItemPanel } from './ItemPage';

type Filters = Record<'status' | 'priority' | 'type' | 'team' | 'assignee' | 'q', string>;
const EMPTY: Filters = { status: '', priority: '', type: '', team: '', assignee: '', q: '' };

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  assignedToMe: number;
  unassigned: number;
  newToday: number;
  newYesterday: number;
}

// Each tab is a preset filter on top of the filter bar.
const TABS = [
  { key: 'all', label: 'All items', params: {} },
  { key: 'mine', label: 'Assigned to me', params: { assignee: 'me' } },
  { key: 'unassigned', label: 'Unassigned', params: { assignee: 'none' } },
  { key: 'approval', label: 'Awaiting approval', params: { status: 'awaiting_approval' } },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function ItemsPage() {
  const { data: me } = useMe();
  const id = Number(useParams().id) || null; // /items/:id opens the item panel over the list
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('all');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  // Wait until typing pauses for 300ms before searching, so we don't send a request per key.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: search.trim() })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const stats = useQuery({ queryKey: ['items', 'stats'], queryFn: () => api<Stats>('/items/stats'), refetchInterval: 15_000 });

  // Cursor pagination: each page returns nextCursor; "Load more" asks for the page after it.
  const params = { ...filters, ...TABS.find((t) => t.key === tab)!.params };
  const list = useInfiniteQuery({
    queryKey: ['items', params],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' });
      for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
      if (pageParam) query.set('cursor', pageParam);
      return api<ItemPage>(`/items?${query}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Refresh every 15 s (like the stats row), so items created or claimed by others show up without a reload.
    refetchInterval: 15_000,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const select = (key: keyof Filters, title: string, options: [string, string][]) => (
    <TextField select size="small" label={title} value={filters[key]} sx={{ minWidth: 130 }}
      onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}>
      <MenuItem value="">Any</MenuItem>
      {options.map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}
    </TextField>
  );
  const canCreate = me?.teams.some((t) => atLeast(t.role, 'member'));
  const tabCount = (key: TabKey) => {
    const s = stats.data;
    if (!s) return undefined;
    return { all: s.total, mine: s.assignedToMe, unassigned: s.unassigned, approval: s.byStatus.awaiting_approval }[key];
  };

  return (
    <>
      <Breadcrumb parts={[<Link key="d" to="/" style={{ color: 'inherit', textDecoration: 'none' }}>Dashboard</Link>, 'Work items']} />
      <PageHeader title="Work items"
        action={canCreate && <Button variant="contained" startIcon={<AddRounded />} onClick={() => setCreating(true)}>New item</Button>} />

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile
        sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <span>{t.label}</span>
              {tabCount(t.key) !== undefined && (
                <Badge badgeContent={tabCount(t.key)} color={tab === t.key ? 'primary' : 'default'} max={99999}
                  sx={{ '& .MuiBadge-badge': { position: 'static', transform: 'none', fontSize: 11 } }} />
              )}
            </Stack>
          } />
        ))}
      </Tabs>

      {stats.data && <StatsRow stats={stats.data} />}

      <Paper sx={{ overflow: 'hidden' }}>
        <Stack direction="row" sx={{ p: 1.5, gap: 1.5, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'primary.main', fontWeight: 600, px: 1 }}>
            <span>Filters</span><TuneRounded fontSize="small" />
          </Stack>
          <TextField size="small" placeholder='Search by words or ID, e.g. refund failed, PAY-20013' value={search}
            onChange={(e) => setSearch(e.target.value)} sx={{ flex: '1 1 260px' }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }} />
          {select('status', 'Status', STATUSES.map((s) => [s, label(s)]))}
          {select('priority', 'Priority', PRIORITIES.map((p) => [p, p]))}
          {select('type', 'Type', TYPES.map((t) => [t, label(t)]))}
          {select('team', 'Team', (me?.teams ?? []).map((t) => [String(t.id), t.name]))}
          {Object.values(filters).some(Boolean) && (
            <Button onClick={() => { setFilters(EMPTY); setSearch(''); }}>Clear</Button>
          )}
        </Stack>

        {list.error && <Alert severity="error">{list.error.message}</Alert>}
        {list.isPending
          ? <Typography sx={{ p: 3 }}>Loading…</Typography>
          : <ItemsTable items={items} empty="No items match these filters" selectedId={id ?? undefined} />}

        <Stack direction="row" sx={{ px: 2.5, py: 1.5, alignItems: 'center', bgcolor: '#f5f7fb', borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            Showing {items.length}{list.hasNextPage ? '+' : ''} items
          </Typography>
          {list.hasNextPage && (
            <Button variant="outlined" size="small" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </Stack>
      </Paper>

      <Drawer anchor="right" open={id !== null} onClose={() => navigate('/items')}
        slotProps={{ paper: { sx: { width: { xs: '100%', md: 'min(1120px, 86vw)' } } } }}>
        {id !== null && <ItemPanel key={id} id={id} onClose={() => navigate('/items')} />}
      </Drawer>

      {creating && <CreateItemDialog onClose={() => setCreating(false)} />}
    </>
  );
}

// Donut of % done, totals, a stacked bar by status, and new items today.
function StatsRow({ stats }: { stats: Stats }) {
  const done = stats.byStatus.resolved + stats.byStatus.closed;
  const active = stats.total - done;
  const pct = stats.total ? Math.round((done / stats.total) * 100) : 0;
  const diff = stats.newToday - stats.newYesterday;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.7fr 1fr' }, gap: 2, mb: 3 }}>
      <Paper sx={{ p: 2.5, display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
        <Donut pct={pct} />
        <Box sx={{ borderLeft: { sm: '1px solid' }, borderColor: { sm: 'divider' }, pl: { sm: 3 } }}>
          <Typography sx={{ fontSize: 22, fontWeight: 700, mb: 1 }}>Total: {stats.total.toLocaleString()}</Typography>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1 }}>
            <AutorenewRounded sx={{ color: 'primary.main' }} />
            <Typography sx={{ fontSize: 20, fontWeight: 700 }}>{active.toLocaleString()}</Typography>
            <Typography color="text.secondary">Active</Typography>
          </Stack>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <TaskAltRounded sx={{ color: 'success.main' }} />
            <Typography sx={{ fontSize: 20, fontWeight: 700 }}>{done.toLocaleString()}</Typography>
            <Typography color="text.secondary">Done</Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={2} sx={{ borderLeft: { sm: '1px solid' }, borderColor: { sm: 'divider' }, pl: { sm: 3 } }}>
          {/* One stacked bar: each status's share of all items. */}
          <Stack sx={{ width: 14, height: 120, borderRadius: 1, overflow: 'hidden' }}>
            {STATUSES.map((s) => (
              <Box key={s} title={`${label(s)}: ${stats.byStatus[s]}`}
                sx={{ flexGrow: stats.byStatus[s] || 0, bgcolor: STATUS_COLORS[s].fg, opacity: 0.85 }} />
            ))}
          </Stack>
          <Stack spacing={0.5} sx={{ justifyContent: 'center' }}>
            {STATUSES.map((s) => (
              <Stack key={s} direction="row" spacing={1} sx={{ alignItems: 'center', fontSize: 13 }}>
                <Box sx={{ width: 9, height: 9, borderRadius: 0.5, bgcolor: STATUS_COLORS[s].fg }} />
                <Box component="span" sx={{ color: 'text.secondary', textTransform: 'capitalize', minWidth: 120 }}>{label(s)}</Box>
                <Box component="span" sx={{ fontWeight: 600 }}>{stats.byStatus[s].toLocaleString()}</Box>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2.5 }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: '#eef3ff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <ErrorOutlineRounded sx={{ color: 'primary.main', fontSize: 34 }} />
        </Box>
        <Box>
          <Typography color="text.secondary" sx={{ fontWeight: 600 }}>New today</Typography>
          <Typography sx={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>{stats.newToday}</Typography>
          <Typography sx={{ color: diff >= 0 ? 'success.main' : 'error.main', fontWeight: 500 }}>
            {diff >= 0 ? '+' : ''}{diff}{' '}
            <Box component="span" sx={{ color: 'text.secondary' }}>vs yesterday ({stats.newYesterday})</Box>
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}

function Donut({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <Stack sx={{ alignItems: 'center' }}>
      <Box sx={{ position: 'relative', width: 96, height: 96 }}>
        <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${pct}% done`}>
          <circle cx="48" cy="48" r={r} fill="none" stroke="#e6e9ef" strokeWidth="12" />
          <circle cx="48" cy="48" r={r} fill="none" stroke="#34c38f" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 48 48)" />
        </svg>
        <Typography sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 22 }}>
          {pct}%
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>Resolved or closed</Typography>
    </Stack>
  );
}

function CreateItemDialog({ onClose }: { onClose: () => void }) {
  const { data: me } = useMe();
  const teams = (me?.teams ?? []).filter((t) => atLeast(t.role, 'member'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '', description: '', type: 'task', priority: 'medium', team_id: teams[0]?.id ?? 0, due_date: '',
  });
  // One key per dialog. If "Create" is clicked twice or the request is retried after a
  // network error, the server sees the same key and creates only one item.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const create = useMutation({
    mutationFn: () => api<Item>('/items', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...form, due_date: form.due_date || null },
    }),
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
      navigate(`/items/${item.id}`);
    },
  });
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <Dialog open onClose={onClose} fullWidth>
      <DialogTitle>New work item</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" value={form.title} onChange={set('title')} required />
          <TextField label="Description" value={form.description} onChange={set('description')} multiline minRows={3} />
          <TextField select label="Team" value={form.team_id}
            onChange={(e) => setForm({ ...form, team_id: Number(e.target.value) })}>
            {teams.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </TextField>
          <TextField select label="Type" value={form.type} onChange={set('type')}>
            {TYPES.map((t) => <MenuItem key={t} value={t}>{label(t)}</MenuItem>)}
          </TextField>
          <TextField select label="Priority" value={form.priority} onChange={set('priority')}>
            {PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField label="Due date" type="date" value={form.due_date} onChange={set('due_date')}
            slotProps={{ inputLabel: { shrink: true } }} />
          {create.error && <Alert severity="error">{create.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => create.mutate()} disabled={create.isPending || !form.title.trim()}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
