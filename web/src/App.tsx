import {
  AppBar, Badge, Box, Button, Container, IconButton, Menu, MenuItem, Toolbar, Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router';
import { api, getToken, setToken } from './api';
import { DashboardPage } from './pages/DashboardPage';
import { ItemPage } from './pages/ItemPage';
import { ItemsPage } from './pages/ItemsPage';
import { LoginPage } from './pages/LoginPage';
import type { Me } from './types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: !!getToken() });
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<RequireAuth />} />
    </Routes>
  );
}

// The token check must run when this route renders, not when App renders: App does not
// re-render on navigation, so a check written inline in App would keep a stale "logged out" answer.
function RequireAuth() {
  return getToken() ? <Layout /> : <Navigate to="/login" replace />;
}

function Layout() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logout = () => {
    setToken(null);
    queryClient.removeQueries(); // drop this user's cached data
    navigate('/login');
  };

  return (
    <>
      <AppBar position="static">
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ mr: 2 }}>Ops</Typography>
          <Button color="inherit" component={Link} to="/">Dashboard</Button>
          <Button color="inherit" component={Link} to="/items">Items</Button>
          <Box sx={{ flexGrow: 1 }} />
          <Notifications />
          <Typography variant="body2" sx={{ mx: 1 }}>
            {me?.name} {me && `· ${me.teams.map((t) => `${t.name}: ${t.role}`).join(', ')}`}
          </Typography>
          <Button color="inherit" onClick={logout}>Logout</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/:id" element={<ItemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </>
  );
}

// Bell with the latest notifications from the outbox worker. Polls every 15 seconds.
function Notifications() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: { id: number; item_id: number; message: string }[] }>('/notifications'),
    refetchInterval: 15_000,
  });
  const list = data?.notifications ?? [];

  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)} aria-label="notifications">
        <Badge badgeContent={list.length} color="secondary">🔔</Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {list.length === 0 && <MenuItem disabled>No notifications</MenuItem>}
        {list.map((n) => (
          <MenuItem key={n.id} onClick={() => { setAnchor(null); navigate(`/items/${n.item_id}`); }}>
            {n.message}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
