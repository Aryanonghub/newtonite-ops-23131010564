import { createTheme } from '@mui/material';

// One place for the look: a black icon rail, a white canvas, one blue accent, thin borders instead of
// heavy shadows. Status and priority colours live here too, so every page agrees.
export const RAIL_BG = '#0e0f12';
export const RAIL_TEXT = '#c9cdd6';
export const ACCENT = '#1f5eff';
export const PANEL_BG = '#f5f7fb'; // light blue-grey for detail grids and table headers

// Outlined pills: text, fill and border per status.
export const STATUS_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  open: { fg: '#1f5eff', bg: '#eef3ff', border: '#9db8ff' },
  in_progress: { fg: '#b45309', bg: '#fff8e6', border: '#f5c76b' },
  awaiting_approval: { fg: '#c2410c', bg: '#fff1e8', border: '#f8b48a' },
  resolved: { fg: '#15803d', bg: '#ecfbf1', border: '#86d9a5' },
  closed: { fg: '#0f766e', bg: '#e9f8f6', border: '#7fd1c6' },
};

export const PRIORITY_COLORS: Record<string, { fg: string; bg: string }> = {
  urgent: { fg: '#b91c1c', bg: '#fde2e2' },
  high: { fg: '#c2410c', bg: '#ffe9d9' },
  medium: { fg: '#a16207', bg: '#fdf3d3' },
  low: { fg: '#15803d', bg: '#dcf5e4' },
};

export const theme = createTheme({
  palette: {
    primary: { main: ACCENT },
    background: { default: '#ffffff', paper: '#ffffff' },
    text: { primary: '#14161a', secondary: '#6b7280' },
    divider: '#e6e9ef',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: '1px solid #e6e9ef' } },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: '#14161a', fontSize: 13, backgroundColor: PANEL_BG },
        root: { borderColor: '#eef0f4' },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, fontSize: 16, minHeight: 48 } } },
    // Floating surfaces keep a soft shadow and lose the border.
    MuiMenu: { styleOverrides: { paper: { border: 'none', boxShadow: '0 8px 24px rgba(15,17,23,0.12)' } } },
    MuiDrawer: { styleOverrides: { paper: { border: 'none' } } },
    MuiSnackbarContent: { styleOverrides: { root: { border: 'none' } } },
  },
});
