import {
  Alert, Button, Divider, List, ListItem, ListItemText, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, api } from '../api';
import { useMe } from '../App';
import { PriorityChip, StatusChip } from '../components';
import { PRIORITIES, label, type ActivityEvent, type Item } from '../types';
import { ACTIONS, atLeast, roleIn } from '../workflow';

// A write = the request to send + what the item should look like if it succeeds.
interface Change {
  request: () => Promise<Item>;
  optimistic: Partial<Item>;
}

export function ItemPage() {
  const id = Number(useParams().id);
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const itemKey = ['item', id];

  const itemQuery = useQuery({ queryKey: itemKey, queryFn: () => api<Item>(`/items/${id}`), refetchInterval: 10_000 });
  const activity = useQuery({
    queryKey: ['activity', id],
    queryFn: () => api<{ events: ActivityEvent[] }>(`/items/${id}/activity`),
    refetchInterval: 10_000,
  });

  const [error, setError] = useState<ApiError | null>(null);
  const [draft, setDraft] = useState<null | { title: string; description: string; priority: string; due_date: string; version: number }>(null);

  // Every item write (claim, transition, edit) goes through this one optimistic mutation.
  const change = useMutation({
    mutationFn: (c: Change) => c.request(),
    onMutate: async (c) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: itemKey }); // so a background poll can't overwrite our optimistic value
      const previous = queryClient.getQueryData<Item>(itemKey);
      if (previous) queryClient.setQueryData(itemKey, { ...previous, ...c.optimistic }); // show the result immediately
      return { previous };
    },
    onError: (err, _c, context) => {
      if (context?.previous) queryClient.setQueryData(itemKey, context.previous); // roll back
      setError(err as ApiError); // show the server's reason (409 / 403 / 422)
    },
    onSuccess: (item) => queryClient.setQueryData(itemKey, item), // the server's version wins
    onSettled: () => {
      for (const key of ['activity', 'items', 'dashboard', 'notifications']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const comment = useMutation({
    mutationFn: (body: string) => api(`/items/${id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activity', id] }),
  });
  const [commentText, setCommentText] = useState('');

  const reload = () => {
    setError(null);
    setDraft(null); // edits were based on an old version; start again from the latest
    queryClient.invalidateQueries({ queryKey: itemKey });
    queryClient.invalidateQueries({ queryKey: ['activity', id] });
  };

  if (itemQuery.error) return <Alert severity="error">{itemQuery.error.message}</Alert>;
  const item = itemQuery.data;
  if (!item || !me) return <Typography>Loading…</Typography>;

  const role = roleIn(me, item.team_id);
  const claim = () => change.mutate({
    request: () => api<Item>(`/items/${id}/claim`, { method: 'POST' }),
    optimistic: { assignee_id: me.id, assignee_name: me.name, status: 'in_progress' },
  });
  const transition = (to: Item['status']) => change.mutate({
    request: () => api<Item>(`/items/${id}/transition`, { method: 'POST', body: { to, version: item.version } }),
    optimistic: { status: to },
  });
  const saveEdit = () => {
    if (!draft) return;
    const { version, ...fields } = draft;
    const body = { ...fields, due_date: fields.due_date || null };
    change.mutate(
      // `version` is the one we had when editing started, not the latest polled one.
      // So if someone else saved meanwhile, the server says 409 instead of silently overwriting them.
      { request: () => api<Item>(`/items/${id}`, { method: 'PATCH', body: { version, ...body } }), optimistic: body },
      { onSuccess: () => setDraft(null) },
    );
  };

  return (
    <Stack spacing={2}>
      {error && (error.status === 409 ? (
        <Alert severity="warning" action={<Button color="inherit" onClick={reload}>Reload</Button>}>
          This item changed, reload. ({error.message})
        </Alert>
      ) : (
        <Alert severity="error" onClose={() => setError(null)}>{error.message}</Alert>
      ))}

      <Paper sx={{ p: 3 }}>
        {draft ? (
          <Stack spacing={2}>
            <TextField label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <TextField label="Description" multiline minRows={3} value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <TextField select label="Priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
              {PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField label="Due date" type="date" value={draft.due_date} slotProps={{ inputLabel: { shrink: true } }}
              onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={saveEdit} disabled={change.isPending}>Save</Button>
              <Button onClick={() => setDraft(null)}>Cancel</Button>
            </Stack>
          </Stack>
        ) : (
          <>
            <Typography variant="h5">#{item.id} {item.title}</Typography>
            <Stack direction="row" spacing={1} sx={{ my: 1, alignItems: 'center' }}>
              <StatusChip status={item.status} />
              <PriorityChip priority={item.priority} />
              <Typography variant="body2" color="text.secondary">
                {label(item.type)} · {item.team_name} · assignee: {item.assignee_name ?? 'none'} ·
                created by {item.created_by_name} · due: {item.due_date ?? '—'} · v{item.version}
              </Typography>
            </Stack>
            <Typography sx={{ whiteSpace: 'pre-wrap', my: 2 }}>{item.description || 'No description.'}</Typography>

            <Stack direction="row" spacing={1}>
              {item.status === 'open' && atLeast(role, 'member') && (
                <Button variant="contained" onClick={claim} disabled={change.isPending}>Claim</Button>
              )}
              {ACTIONS[item.status].filter((a) => atLeast(role, a.minRole)).map((a) => (
                <Button key={a.to} variant="outlined" onClick={() => transition(a.to)} disabled={change.isPending}>
                  {a.label}
                </Button>
              ))}
              {atLeast(role, 'member') && (
                <Button onClick={() => setDraft({
                  title: item.title, description: item.description, priority: item.priority,
                  due_date: item.due_date ?? '', version: item.version,
                })}>Edit</Button>
              )}
            </Stack>
          </>
        )}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6">Activity</Typography>
        <List dense>
          {activity.data?.events.map((e) => (
            <ListItem key={e.id} disableGutters>
              <ListItemText primary={`${e.actor_name} ${describe(e)}`} secondary={new Date(e.created_at).toLocaleString()} />
            </ListItem>
          ))}
        </List>
        {atLeast(role, 'member') && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1}>
              <TextField size="small" fullWidth placeholder="Add a comment" value={commentText}
                onChange={(e) => setCommentText(e.target.value)} />
              <Button variant="contained" disabled={!commentText.trim() || comment.isPending}
                onClick={() => comment.mutate(commentText, { onSuccess: () => setCommentText('') })}>
                Comment
              </Button>
            </Stack>
            {comment.error && <Alert severity="error" sx={{ mt: 1 }}>{comment.error.message}</Alert>}
          </>
        )}
      </Paper>
    </Stack>
  );
}

function describe(e: ActivityEvent): string {
  switch (e.kind) {
    case 'created': return 'created the item';
    case 'status_changed': return `moved it from ${label(e.from_value ?? '')} to ${label(e.to_value ?? '')}`;
    case 'assignee_changed': return `assigned it to ${e.to_name ?? 'nobody'}`;
    case 'priority_changed': return `changed priority from ${e.from_value} to ${e.to_value}`;
    case 'edited': return `edited the ${label(e.field ?? 'item')}`;
    case 'commented': return `commented: "${e.comment}"`;
    default: return e.kind;
  }
}
