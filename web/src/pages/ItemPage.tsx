import {
  Alert, Avatar, Box, Button, Divider, MenuItem, Paper, Snackbar, Stack, Step, StepLabel, Stepper, TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, api } from '../api';
import { useMe } from '../App';
import { PriorityChip, StatusChip } from '../components';
import { PRIORITIES, STATUSES, label, timeAgo, type ActivityEvent, type Item } from '../types';
import { ACTIONS, atLeast, canApprove, nextStep, roleIn } from '../workflow';

// A write = the request to send, what the item should look like if it succeeds,
// and the message to show when the server confirms it.
interface Change {
  request: () => Promise<Item>;
  optimistic: Partial<Item>;
  success: string;
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
  const [toast, setToast] = useState<string | null>(null); // success popup
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
    onSuccess: (item, c) => {
      queryClient.setQueryData(itemKey, item); // the server's version wins
      setToast(c.success); // only after the server confirmed, never on the optimistic guess
    },
    onSettled: () => {
      for (const key of ['activity', 'items', 'dashboard', 'notifications']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const comment = useMutation({
    mutationFn: (body: string) => api(`/items/${id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
      setToast('Comment added');
    },
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
  const submittedByMe = item.submitted_by === me.id;
  const claim = () => change.mutate({
    request: () => api<Item>(`/items/${id}/claim`, { method: 'POST' }),
    optimistic: { assignee_id: me.id, assignee_name: me.name, status: 'in_progress' },
    success: 'You claimed this item',
  });
  const transition = (to: Item['status'], success: string) => change.mutate({
    request: () => api<Item>(`/items/${id}/transition`, { method: 'POST', body: { to, version: item.version } }),
    optimistic: { status: to },
    success,
  });
  const saveEdit = () => {
    if (!draft) return;
    const { version, ...fields } = draft;
    const body = { ...fields, due_date: fields.due_date || null };
    change.mutate(
      // `version` is the one we had when editing started, not the latest polled one.
      // So if someone else saved meanwhile, the server says 409 instead of silently overwriting them.
      {
        request: () => api<Item>(`/items/${id}`, { method: 'PATCH', body: { version, ...body } }),
        optimistic: body,
        success: 'Changes saved',
      },
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
                created by {item.created_by_name}
                {item.submitted_by_name && ` · submitted by ${item.submitted_by_name}`} · due: {item.due_date ?? '—'} ·
                v{item.version}
              </Typography>
            </Stack>
            <WorkflowSteps status={item.status} />
            <Typography sx={{ whiteSpace: 'pre-wrap', my: 2 }}>{item.description || 'No description.'}</Typography>

            <Stack direction="row" spacing={1}>
              {item.status === 'open' && atLeast(role, 'member') && (
                <Button variant="contained" onClick={claim} disabled={change.isPending}>Claim</Button>
              )}
              {ACTIONS[item.status]
                // 'resolved' is the Approve button, the only one that also needs the four-eyes check.
                .filter((a) => atLeast(role, a.minRole) && (a.to !== 'resolved' || canApprove(role, submittedByMe)))
                .map((a) => (
                <Button key={a.to} variant="outlined" onClick={() => transition(a.to, a.done)} disabled={change.isPending}>
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
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {nextStep(item.status, role, item.team_name, submittedByMe)}
            </Typography>
          </>
        )}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Activity</Typography>
        <Timeline events={activity.data?.events ?? []} />
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

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </Stack>
  );
}

// Step bar: where the item is in the workflow. Steps before the current one show as done.
function WorkflowSteps({ status }: { status: Item['status'] }) {
  const current = STATUSES.indexOf(status);
  // Closed is the last step, so mark it done too instead of "in progress".
  const activeStep = status === 'closed' ? STATUSES.length : current;
  return (
    <Stepper activeStep={activeStep} alternativeLabel sx={{ my: 3 }}>
      {STATUSES.map((s) => (
        <Step key={s}>
          <StepLabel sx={{ textTransform: 'capitalize' }}>{label(s)}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}

// One colour per kind of event, used for the avatar dot.
const KIND_COLOR: Record<string, string> = {
  created: '#1976d2',
  status_changed: '#9c27b0',
  assignee_changed: '#2e7d32',
  priority_changed: '#ed6c02',
  edited: '#757575',
  commented: '#0288d1',
};

// Vertical timeline: avatar with the actor's initial, a line joining events, comments as bubbles.
function Timeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return <Typography color="text.secondary">No activity yet.</Typography>;
  return (
    <Stack>
      {events.map((e, i) => (
        <Stack key={e.id} direction="row" spacing={2}>
          <Stack sx={{ alignItems: 'center' }}>
            <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: KIND_COLOR[e.kind] ?? 'grey.500' }}>
              {e.actor_name.charAt(0)}
            </Avatar>
            {i < events.length - 1 && <Box sx={{ flexGrow: 1, width: 2, bgcolor: 'divider', my: 0.5 }} />}
          </Stack>
          <Box sx={{ pb: 2.5, flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2"><b>{e.actor_name}</b> {describe(e)}</Typography>
            {/* Hover shows the exact date and time. */}
            <Typography variant="caption" color="text.secondary" title={new Date(e.created_at).toLocaleString()}>
              {timeAgo(e.created_at)}
            </Typography>
            {e.kind === 'commented' && (
              <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, bgcolor: 'grey.50', whiteSpace: 'pre-wrap' }}>
                {e.comment}
              </Paper>
            )}
          </Box>
        </Stack>
      ))}
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
    case 'commented': return 'commented'; // the text is shown in a bubble below
    default: return e.kind;
  }
}
