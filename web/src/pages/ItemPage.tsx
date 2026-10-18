import CloseRounded from '@mui/icons-material/CloseRounded';
import {
  Alert, AlertTitle, Box, Button, IconButton, MenuItem, Paper, Snackbar, Stack, Step, StepLabel, Stepper, TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, api, newIdempotencyKey } from '../api';
import { useMe } from '../App';
import { useLiveUpdates } from '../live';
import { DetailGrid, DueDate, Person, PersonAvatar, PriorityChip, StatusChip, shortName } from '../components';
import { PANEL_BG } from '../theme';
import { PRIORITIES, STATUSES, itemCode, label, timeAgo, type ActivityEvent, type Item } from '../types';
import { ACTIONS, atLeast, canApprove, canMove, nextStep, roleIn } from '../workflow';

// A write = the request to send, what the item should look like if it succeeds,
// and the message to show when the server confirms it.
interface Change {
  request: () => Promise<Item>;
  optimistic: Partial<Item>;
  success: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// The item, shown as a panel that slides over the work items list.
export function ItemPanel({ id, onClose }: { id: number; onClose: () => void }) {
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
    // A network failure (no answer at all) is retried; the request reuses its Idempotency-Key, so if
    // the first attempt did reach the server, the retry gets the stored answer instead of a 409.
    // Answers from the server (403, 409, 422) are final and never retried.
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
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
    // The key is made once per submit, so a network retry or a double click posts the comment once.
    mutationFn: ({ body, key }: { body: string; key: string }) =>
      api(`/items/${id}/comments`, { method: 'POST', body: { body }, headers: { 'Idempotency-Key': key } }),
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
      setToast('Comment added');
    },
  });
  const [commentText, setCommentText] = useState('');

  // Someone else changed this item: refetch it and its history. Skipped while our own change is in
  // flight, so the optimistic value isn't overwritten; that change refetches when it settles anyway.
  // The 10 s polling above stays as a fallback in case the stream is down.
  useLiveUpdates(`/items/${id}/live`, () => {
    if (change.isPending) return;
    queryClient.invalidateQueries({ queryKey: itemKey });
    queryClient.invalidateQueries({ queryKey: ['activity', id] });
  });

  const reload = () => {
    setError(null);
    setDraft(null); // edits were based on an old version; start again from the latest
    queryClient.invalidateQueries({ queryKey: itemKey });
    queryClient.invalidateQueries({ queryKey: ['activity', id] });
  };

  if (itemQuery.error) {
    return (
      <Box sx={{ p: 3 }}>
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 2 }}>
          <IconButton onClick={onClose} aria-label="Close"><CloseRounded /></IconButton>
        </Stack>
        <Alert severity="error">{itemQuery.error.message}</Alert>
      </Box>
    );
  }
  const item = itemQuery.data;
  if (!item || !me) return <Typography sx={{ p: 3 }}>Loading…</Typography>;

  const role = roleIn(me, item.team_id);
  const submittedByMe = item.submitted_by === me.id;
  // One key per click: retries of the same click share it, a new click gets a new one.
  const keyHeader = () => ({ 'Idempotency-Key': newIdempotencyKey() });
  const claim = () => {
    const headers = keyHeader();
    change.mutate({
      request: () => api<Item>(`/items/${id}/claim`, { method: 'POST', headers }),
      optimistic: { assignee_id: me.id, assignee_name: me.name, status: 'in_progress' },
      success: 'You claimed this item',
    });
  };
  const transition = (to: Item['status'], success: string) => {
    const headers = keyHeader();
    change.mutate({
      request: () => api<Item>(`/items/${id}/transition`, { method: 'POST', body: { to, version: item.version }, headers }),
      optimistic: { status: to },
      success,
    });
  };
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

  // Same rules as the server: Approve ('resolved') needs four-eyes; every other move needs ownership.
  const movable = canMove(role, item.assignee_id, me.id);
  const actions = ACTIONS[item.status]
    .filter((a) => atLeast(role, a.minRole) && (a.to === 'resolved' ? canApprove(role, submittedByMe) : movable));
  const canEdit = atLeast(role, 'member');

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 300px' }, minHeight: '100%' }}>
      {/* Main column: what the item is and what happened to it */}
      <Box sx={{ p: { xs: 2, sm: 4 }, minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }}>
          <Typography sx={{ flexGrow: 1, fontWeight: 600 }}>
            {item.team_name} <Box component="span" sx={{ color: 'text.secondary', mx: 1 }}>›</Box> {itemCode(item)}
          </Typography>
          <IconButton onClick={onClose} aria-label="Close" sx={{ border: '1px solid', borderColor: 'divider' }}>
            <CloseRounded fontSize="small" />
          </IconButton>
        </Stack>

        {error && (error.status === 409 ? (
          <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={reload}>Reload</Button>}>
            <AlertTitle>This item changed, reload</AlertTitle>
            {error.message /* who got there first, e.g. "Priya approved it since you loaded this item." */}
          </Alert>
        ) : (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error.message}</Alert>
        ))}

        {draft ? (
          <Stack spacing={2} sx={{ mb: 3 }}>
            <Typography variant="h6">Edit item</Typography>
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
            <Typography variant="h5" sx={{ fontSize: { xs: 22, md: 26 } }}>{item.title}</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', mt: 1.5, color: item.description ? 'text.primary' : 'text.secondary' }}>
              {item.description || 'No description.'}
            </Typography>
            <WorkflowSteps status={item.status} />
            <DetailGrid title="Item details" rows={[
              ['Type', <span style={{ textTransform: 'capitalize' }}>{label(item.type)}</span>],
              ['Team', item.team_name],
              ['Created by', <Person name={item.created_by_name} short />],
              ['Created on', formatDate(item.created_at)],
              ['Due date', <DueDate item={item} />],
              ['Version', `v${item.version}`],
            ]} />
          </>
        )}

        <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>Activity</Typography>
        <Timeline events={activity.data?.events ?? []} />
        {canEdit && (
          <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
            <PersonAvatar name={me.name} size={32} />
            <Paper sx={{ flexGrow: 1, p: 1.5 }}>
              <TextField variant="standard" fullWidth multiline minRows={2} placeholder="Leave a comment…" value={commentText}
                onChange={(e) => setCommentText(e.target.value)} slotProps={{ input: { disableUnderline: true } }} />
              <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                <Button variant="contained" size="small" disabled={!commentText.trim() || comment.isPending}
                  onClick={() => comment.mutate({ body: commentText, key: newIdempotencyKey() }, { onSuccess: () => setCommentText('') })}>
                  Comment
                </Button>
              </Stack>
            </Paper>
          </Stack>
        )}
        {comment.error && <Alert severity="error" sx={{ mt: 1 }}>{comment.error.message}</Alert>}
      </Box>

      {/* Right column: who, the key facts, and what to do next */}
      <Stack sx={{ borderLeft: { md: '1px solid' }, borderTop: { xs: '1px solid', md: 'none' }, borderColor: 'divider', p: 3 }}>
        <Section title="Assignee details">
          <Field name="Assignee"><Person name={item.assignee_name} short /></Field>
          {item.submitted_by_name && <Field name="Submitted by"><Person name={item.submitted_by_name} short /></Field>}
        </Section>
        <Section title="Other information">
          <Field name="Status"><StatusChip status={item.status} testId="item-status" /></Field>
          <Field name="Priority"><PriorityChip priority={item.priority} /></Field>
          <Field name="Last updated">
            <Typography variant="body2" title={formatDate(item.updated_at)}>{timeAgo(item.updated_at)}</Typography>
          </Field>
        </Section>

        <Box sx={{ flexGrow: 1 }} />

        <Box sx={{ position: { md: 'sticky' }, bottom: 0, bgcolor: 'background.paper', pt: 2 }}>
          <Box sx={{ bgcolor: PANEL_BG, borderRadius: 2, p: 1.5, mb: 1.5 }}>
            <Typography variant="body2">
              <b>Next step:</b> {movable || !atLeast(role, 'member') || !item.assignee_name
                ? nextStep(item.status, role, item.team_name, submittedByMe)
                : `Assigned to ${shortName(item.assignee_name)}. Only they or a Lead of ${item.team_name} can move it; you can still comment.`}
            </Typography>
          </Box>
          <Stack spacing={1}>
            {item.status === 'open' && atLeast(role, 'member') && (
              <Button variant="contained" size="large" fullWidth onClick={claim} disabled={change.isPending}>Claim</Button>
            )}
            {actions.map((a, i) => (
              <Button key={a.to} variant={i === 0 ? 'contained' : 'outlined'} size="large" fullWidth
                onClick={() => transition(a.to, a.done)} disabled={change.isPending}>
                {a.label}
              </Button>
            ))}
            {canEdit && !draft && (
              <Button fullWidth onClick={() => setDraft({
                title: item.title, description: item.description, priority: item.priority,
                due_date: item.due_date ?? '', version: item.version,
              })}>Edit</Button>
            )}
          </Stack>
        </Box>
      </Stack>

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, pb: 1, mb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Stack direction="row" sx={{ py: 1, alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{name}</Typography>
      <Box sx={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>{children}</Box>
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

// Vertical timeline: the actor's avatar, a line joining events, comments as bubbles.
function Timeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return <Typography color="text.secondary">No activity yet.</Typography>;
  return (
    <Stack>
      {events.map((e, i) => (
        <Stack key={e.id} direction="row" spacing={2}>
          <Stack sx={{ alignItems: 'center' }}>
            <PersonAvatar name={e.actor_name} size={32} />
            {i < events.length - 1 && <Box sx={{ flexGrow: 1, width: 2, bgcolor: 'divider', my: 0.5 }} />}
          </Stack>
          <Box sx={{ pb: 2.5, flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2">
              <b>{e.actor_name}</b> {describe(e)}
              {/* Hover shows the exact date and time. */}
              <Box component="span" title={new Date(e.created_at).toLocaleString()} sx={{ color: 'text.secondary', ml: 1 }}>
                {timeAgo(e.created_at)}
              </Box>
            </Typography>
            {e.kind === 'commented' && (
              <Paper sx={{ p: 1.5, mt: 0.75, bgcolor: PANEL_BG, whiteSpace: 'pre-wrap' }}>{e.comment}</Paper>
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
