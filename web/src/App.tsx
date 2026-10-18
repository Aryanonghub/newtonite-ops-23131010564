import {
  AppBar, Badge, Box, Button, Divider, Drawer, IconButton, List, ListItemButton, ListItemText, Menu, MenuItem,
  Stack, Toolbar, Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, getToken, setToken } from './api';
import { Brand } from './brand';
import { PersonAvatar } from './components';
import { DashboardPage } from './pages/DashboardPage';
import { ItemPage } from './pages/ItemPage';
import { ItemsPage } from './pages/ItemsPage';
import { LoginPage } from './pages/LoginPage';
import { SIDEBAR_BG, SIDEBAR_TEXT } from './theme';
import { timeAgo, type Me } from './types';

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

const SIDEBAR_WIDTH = 248;

// Desktop: a fixed dark sidebar. Phone: a top bar with a menu button that slides the same sidebar in.
function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar = <Sidebar onNavigate={() => setMobileOpen(false)} />;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer variant="permanent" sx={{ display: { xs: 'none', md: 'block' }, width: SIDEBAR_WIDTH, flexShrink: 0 }}
        slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, bgcolor: SIDEBAR_BG, border: 'none' } } }}>
        {sidebar}
      </Drawer>
      <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} sx={{ display: { md: 'none' } }}
        slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, bgcolor: SIDEBAR_BG, border: 'none' } } }}>
        {sidebar}
      </Drawer>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <AppBar position="sticky" elevation={0} sx={{ display: { md: 'none' }, bgcolor: SIDEBAR_BG }}>
          <Toolbar>
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(true)} aria-label="open menu">☰</IconButton>
            <Box sx={{ ml: 1, flexGrow: 1 }}><Brand dark /></Box>
            <Notifications />
          </Toolbar>
        </AppBar>
        <Box sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/items" element={<ItemsPage />} />
            <Route path="/items/:id" element={<ItemPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/items', label: 'Work items' },
];

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { data: me } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));

  const logout = () => {
    setToken(null);
    queryClient.removeQueries(); // drop this user's cached data
    navigate('/login');
  };

  return (
    <Stack sx={{ height: '100%', color: SIDEBAR_TEXT, p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', px: 1, py: 1, mb: 2 }}>
        <Box sx={{ flexGrow: 1 }}><Brand dark /></Box>
        <Box sx={{ display: { xs: 'none', md: 'block' } }}><Notifications /></Box>
      </Stack>

      <List disablePadding>
        {NAV.map((n) => (
          <ListItemButton key={n.to} component={Link} to={n.to} onClick={onNavigate} selected={isActive(n.to)}
            sx={{
              borderRadius: 2, mb: 0.5, color: SIDEBAR_TEXT,
              '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' },
              '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
            }}>
            <ListItemText primary={n.label} slotProps={{ primary: { sx: { fontWeight: 600, fontSize: 14 } } }} />
          </ListItemButton>
        ))}
      </List>

      <Box sx={{ flexGrow: 1 }} />

      {me && (
        <>
          <Typography variant="caption" sx={{ px: 1, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Your teams
          </Typography>
          <Stack sx={{ px: 1, mt: 1, mb: 2 }} spacing={0.5}>
            {me.teams.map((t) => (
              <Stack key={t.id} direction="row" sx={{ justifyContent: 'space-between', fontSize: 13 }}>
                <span>{t.name}</span>
                <Box component="span" sx={{ color: '#9ca3af', textTransform: 'capitalize' }}>{t.role}</Box>
              </Stack>
            ))}
          </Stack>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mb: 1.5 }} />
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 1 }}>
            <PersonAvatar name={me.name} size={32} />
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography variant="body2" noWrap sx={{ color: '#fff', fontWeight: 600 }}>{me.name}</Typography>
              <Typography variant="caption" noWrap sx={{ color: '#9ca3af', display: 'block' }}>{me.email}</Typography>
            </Box>
          </Stack>
          <Button onClick={logout} size="small" sx={{ mt: 1.5, color: SIDEBAR_TEXT, justifyContent: 'flex-start', px: 1 }}>
            Log out
          </Button>
        </>
      )}
    </Stack>
  );
}

// Bell with the latest notifications from the outbox worker. Polls every 15 seconds.
function Notifications() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: { id: number; item_id: number; message: string; created_at: string }[] }>('/notifications'),
    refetchInterval: 15_000,
  });
  const list = data?.notifications ?? [];

  return (
    <>
      <IconButton sx={{ color: SIDEBAR_TEXT }} onClick={(e) => setAnchor(e.currentTarget)} aria-label="notifications">
        <Badge badgeContent={list.length} color="primary" max={9}>🔔</Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 360, maxHeight: 440 } } }}>
        <Typography variant="subtitle2" sx={{ px: 2, py: 1 }}>Notifications</Typography>
        {list.length === 0 && <MenuItem disabled>Nothing yet</MenuItem>}
        {list.map((n) => (
          <MenuItem key={n.id} onClick={() => { setAnchor(null); navigate(`/items/${n.item_id}`); }}
            sx={{ whiteSpace: 'normal', alignItems: 'flex-start', flexDirection: 'column', py: 1 }}>
            <Typography variant="body2">{n.message}</Typography>
            <Typography variant="caption" color="text.secondary">{timeAgo(n.created_at)}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
