import { Alert, Box, Button, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, setToken } from '../api';
import { Brand } from '../brand';
import { IS_LOCAL } from '../env';
import { PersonAvatar } from '../components';
import { RAIL_BG, RAIL_TEXT } from '../theme';

// Seeded demo accounts (all use password123), one per role. Clicking one logs straight in.
const DEMO = [
  { email: 'admin@ops.test', name: 'Ada Admin', role: 'Admin · all teams' },
  { email: 'priya@ops.test', name: 'Priya', role: 'Lead · Payments' },
  { email: 'mohan@ops.test', name: 'Mohan', role: 'Member · Payments' },
  { email: 'sara@ops.test', name: 'Sara', role: 'Member · Payments + Support' },
  { email: 'vik@ops.test', name: 'Vik', role: 'Viewer · read-only' },
  { email: 'lena@ops.test', name: 'Lena', role: 'Lead · Support' },
];

// What the system guarantees, shown on the left so a reviewer knows what to try.
const PROMISES = [
  ['One winner per claim', 'Two people claim at once: one succeeds, the other is told who did.'],
  ['No silent overwrites', 'Acting on an old page is refused with what changed and by whom.'],
  ['Four-eyes approval', 'Only a Lead of the team approves, and never their own submission.'],
  ['History you can trust', 'Every change and its history entry commit together, or not at all.'],
];

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api<{ token: string }>('/auth/login', { method: 'POST', body: creds }),
    onSuccess: ({ token }) => {
      setToken(token);
      queryClient.removeQueries(); // drop cached data from any previous user
      navigate('/');
    },
  });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left: brand and what the system promises. Hidden on small screens. */}
      <Stack sx={{
        display: { xs: 'none', md: 'flex' }, width: '44%', bgcolor: RAIL_BG, color: RAIL_TEXT, p: 6,
        backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(31,94,255,0.35), transparent 55%)',
      }}>
        <Brand dark size={34} />
        <Box sx={{ my: 'auto', maxWidth: 440 }}>
          <Typography variant="h4" sx={{ color: '#fff', mb: 1.5 }}>Operations under pressure</Typography>
          <Typography sx={{ mb: 4 }}>
            Payments, Support and Compliance teams create, claim and resolve work items, and the system stays
            correct when many people act on the same item at once.
          </Typography>
          <Stack spacing={2.5}>
            {PROMISES.map(([title, text]) => (
              <Stack key={title} direction="row" spacing={1.5}>
                <Box sx={{ mt: '3px', width: 18, height: 18, flexShrink: 0, borderRadius: '50%', bgcolor: '#1f5eff',
                  color: '#fff', fontSize: 11, display: 'grid', placeItems: 'center' }}>✓</Box>
                <Box>
                  <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{title}</Typography>
                  <Typography variant="body2">{text}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
        <Typography variant="caption" sx={{ color: '#6b7280' }}>
          A Newtonite Software Engineering Challenge submission, not an official Newtonite product.
        </Typography>
      </Stack>

      {/* Right: sign in. */}
      <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ width: '100%', maxWidth: 440 }}>
          <Box sx={{ display: { md: 'none' }, mb: 4 }}><Brand size={30} /></Box>
          {IS_LOCAL && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              You are on a <b>local copy</b>. Its items are separate from the live site, so the same ID can be a different item there.
            </Alert>
          )}
          <Typography variant="h5">Sign in</Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>Pick a demo person, or use an email and password.</Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
            {DEMO.map((d) => (
              <Paper key={d.email} component="button" type="button" disabled={login.isPending}
                onClick={() => login.mutate({ email: d.email, password: 'password123' })}
                sx={{
                  p: 1.5, display: 'flex', alignItems: 'center', gap: 1.25, textAlign: 'left', cursor: 'pointer',
                  font: 'inherit', bgcolor: 'background.paper', transition: 'border-color .15s, box-shadow .15s',
                  '&:hover': { borderColor: 'primary.main', boxShadow: '0 0 0 3px rgba(31,94,255,0.12)' },
                }}>
                <PersonAvatar name={d.name} size={32} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{d.name}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{d.role}</Typography>
                </Box>
              </Paper>
            ))}
          </Box>

          <Divider sx={{ my: 3, color: 'text.secondary', fontSize: 13 }}>or</Divider>

          <Stack component="form" spacing={2} onSubmit={(e) => { e.preventDefault(); login.mutate({ email, password }); }}>
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" helperText="Every demo account uses password123" />
            {login.error && <Alert severity="error">{login.error.message}</Alert>}
            <Button type="submit" variant="contained" size="large" disabled={login.isPending || !email || !password}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
