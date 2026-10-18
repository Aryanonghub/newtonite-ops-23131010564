import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { useMe } from '../App';
import { ItemsTable } from '../components';
import { PRIORITIES, STATUSES, TYPES, label, type Item, type ItemPage } from '../types';
import { atLeast } from '../workflow';

type Filters = Record<'status' | 'priority' | 'type' | 'team' | 'assignee' | 'q', string>;
const EMPTY: Filters = { status: '', priority: '', type: '', team: '', assignee: '', q: '' };

export function ItemsPage() {
  const { data: me } = useMe();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  // Wait until typing pauses for 300ms before searching, so we don't send a request per key.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: search.trim() })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Cursor pagination: each page returns nextCursor; "Load more" asks for the page after it.
  const list = useInfiniteQuery({
    queryKey: ['items', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '25' });
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
      if (pageParam) params.set('cursor', pageParam);
      return api<ItemPage>(`/items?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const select = (key: keyof Filters, title: string, options: [string, string][]) => (
    <TextField select size="small" label={title} value={filters[key]} sx={{ minWidth: 140 }}
      onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}>
      <MenuItem value="">Any</MenuItem>
      {options.map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}
    </TextField>
  );
  const canCreate = me?.teams.some((t) => atLeast(t.role, 'member'));

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>Work items</Typography>
        {canCreate && <Button variant="contained" onClick={() => setCreating(true)}>New item</Button>}
      </Stack>

      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <TextField size="small" label="Search" placeholder='e.g. refund failed, "card declined"' value={search} onChange={(e) => setSearch(e.target.value)} />
        {select('status', 'Status', STATUSES.map((s) => [s, label(s)]))}
        {select('priority', 'Priority', PRIORITIES.map((p) => [p, p]))}
        {select('type', 'Type', TYPES.map((t) => [t, label(t)]))}
        {select('team', 'Team', (me?.teams ?? []).map((t) => [String(t.id), t.name]))}
        {select('assignee', 'Assignee', [['me', 'Me'], ['none', 'Unassigned']])}
      </Stack>

      <Paper>
        {list.error && <Alert severity="error">{list.error.message}</Alert>}
        {list.isPending ? <Typography sx={{ p: 2 }}>Loading…</Typography> : <ItemsTable items={items} />}
      </Paper>
      {list.hasNextPage && (
        <Button onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
          {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}

      {creating && <CreateItemDialog onClose={() => setCreating(false)} />}
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
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const create = useMutation({
    mutationFn: () => api<Item>('/items', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...form, due_date: form.due_date || null },
    }),
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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
