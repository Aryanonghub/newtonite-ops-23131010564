import ConfirmationNumberOutlined from '@mui/icons-material/ConfirmationNumberOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined';
import { Badge, Box, Divider, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, getToken, setToken } from './api';
import { LOGO_SRC } from './brand';
import { IS_LOCAL } from './env';
import { PersonAvatar } from './components';
import { DashboardPage } from './pages/DashboardPage';
import { ItemsPage } from './pages/ItemsPage';
import { LoginPage } from './pages/LoginPage';
import { RAIL_BG, RAIL_TEXT } from './theme';
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

const RAIL = 72;

// A black icon rail on the left (a bar across the top on phones), and the page on a white canvas.
function Layout() {
  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh' }}>
      <Rail />
      <Box sx={{ flexGrow: 1, minWidth: 0, ml: { md: `${RAIL}px` } }}>
        <Box sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 4 }, maxWidth: 1400, mx: 'auto' }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            {/* The list stays mounted and the item opens as a panel over it, so filters survive. */}
            <Route path="/items/:id?" element={<ItemsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

function Rail() {
  const { data: me } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null);

  const logout = () => {
    setToken(null);
    queryClient.removeQueries(); // drop this user's cached data
    navigate('/login');
  };

  return (
    <Stack component="nav" sx={{
      bgcolor: RAIL_BG, color: RAIL_TEXT, alignItems: 'center', gap: 1, zIndex: 1200,
      flexDirection: { xs: 'row', md: 'column' }, px: { xs: 1.5, md: 0 }, py: { xs: 1, md: 2 },
      position: { xs: 'sticky', md: 'fixed' }, top: 0, left: 0,
      width: { xs: '100%', md: RAIL }, height: { md: '100vh' },
    }}>
      <Box component={Link} to="/" aria-label="Newtonite Ops home" sx={{ mb: { md: 2 }, mr: { xs: 1, md: 0 } }}>
        <Box component="img" src={LOGO_SRC} alt="Newtonite" sx={{ width: 40, height: 40, borderRadius: '50%',
          display: 'block', boxShadow: '0 0 0 1px rgba(255,255,255,0.18)' }} />
      </Box>
      {IS_LOCAL && <LocalBadge />}
      <RailLink to="/" label="Dashboard" active={location.pathname === '/'} icon={<SpaceDashboardOutlined />} />
      <RailLink to="/items" label="Work items" active={location.pathname.startsWith('/items')} icon={<ConfirmationNumberOutlined />} />
      <Notifications />

      <Box sx={{ flexGrow: 1 }} />

      {me && (
        <>
          <Tooltip title={me.name} placement="right">
            <IconButton onClick={(e) => setUserMenu(e.currentTarget)} aria-label="account">
              <PersonAvatar name={me.name} size={34} />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={userMenu} open={!!userMenu} onClose={() => setUserMenu(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
            <Box sx={{ px: 2, py: 1, minWidth: 240 }}>
              <Typography variant="subtitle2">{me.name}</Typography>
              <Typography variant="caption" color="text.secondary">{me.email}</Typography>
              <Stack sx={{ mt: 1 }} spacing={0.5}>
                {me.teams.map((t) => (
                  <Stack key={t.id} direction="row" sx={{ justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{t.name}</span>
                    <Box component="span" sx={{ color: 'text.secondary', textTransform: 'capitalize' }}>{t.role}</Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
            <Divider />
            <MenuItem onClick={logout}><LogoutOutlined fontSize="small" sx={{ mr: 1 }} />Log out</MenuItem>
          </Menu>
        </>
      )}
    </Stack>
  );
}

// Shown only on a local copy (Docker on this machine): its data is separate from the live site's.
export function LocalBadge() {
  return (
    <Tooltip title="Local copy: separate data from the live site" placement="right">
      <Box sx={{ bgcolor: '#f59e0b', color: '#111', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
        px: 0.75, py: 0.25, borderRadius: 1, mb: { md: 1 } }}>LOCAL</Box>
    </Tooltip>
  );
}

function RailLink({ to, label, icon, active }: { to: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Tooltip title={label} placement="right">
      <IconButton component={Link} to={to} aria-label={label} sx={{
        width: 48, height: 48, borderRadius: 2, color: active ? '#fff' : RAIL_TEXT,
        bgcolor: active ? 'rgba(255,255,255,0.12)' : 'transparent', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
      }}>
        {icon}
      </IconButton>
    </Tooltip>
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
      <Tooltip title="Notifications" placement="right">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="notifications"
          sx={{ width: 48, height: 48, borderRadius: 2, color: RAIL_TEXT, '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' } }}>
          <Badge badgeContent={list.length} color="primary" max={9}><NotificationsNoneOutlined /></Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
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
