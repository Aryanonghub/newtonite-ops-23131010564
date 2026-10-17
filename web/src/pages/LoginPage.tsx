import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, setToken } from '../api';

// Seeded demo accounts (all use password123), one per role.
const DEMO = [
  ['admin@ops.test', 'Admin (all teams)'],
  ['priya@ops.test', 'Lead (Payments)'],
  ['mohan@ops.test', 'Member (Payments)'],
  ['sara@ops.test', 'Member (Payments + Support)'],
  ['vik@ops.test', 'Viewer'],
  ['lena@ops.test', 'Lead (Support)'],
];

export function LoginPage() {
  const [email, setEmail] = useState('priya@ops.test');
  const [password, setPassword] = useState('password123');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const login = useMutation({
    mutationFn: () => api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: ({ token }) => {
      setToken(token);
      queryClient.removeQueries(); // drop cached data from any previous user
      navigate('/');
    },
  });

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <Paper sx={{ p: 4, width: 420 }}>
        <Typography variant="h5" gutterBottom>Ops Under Pressure</Typography>
        <Stack component="form" spacing={2} onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
          <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {login.error && <Alert severity="error">{login.error.message}</Alert>}
          <Button type="submit" variant="contained" disabled={login.isPending}>Log in</Button>
        </Stack>
        <Typography variant="subtitle2" sx={{ mt: 3 }}>Demo users (password123)</Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {DEMO.map(([demoEmail, role]) => (
            <Button key={demoEmail} size="small" variant="outlined" onClick={() => setEmail(demoEmail)}>{role}</Button>
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}
