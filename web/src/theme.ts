import { createTheme } from '@mui/material';

// One place for the look: a calm light canvas, a dark sidebar, one accent colour, and thin borders
// instead of heavy shadows. Status and priority colours live here too, so every page agrees.
export const SIDEBAR_BG = '#0f1117';
export const SIDEBAR_TEXT = '#c9cdd6';

export const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  open: { fg: '#475569', bg: '#eef1f5' },
  in_progress: { fg: '#9a4a05', bg: '#fdf0dc' },
  awaiting_approval: { fg: '#6d28d9', bg: '#efe9fd' },
  resolved: { fg: '#15803d', bg: '#e3f5e9' },
  closed: { fg: '#5d6470', bg: '#eeeff1' },
};

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  high: '#ea580c',
  medium: '#2563eb',
  low: '#94a3b8',
};

export const theme = createTheme({
  palette: {
    primary: { main: '#4f46e5' },
    background: { default: '#f6f7f9', paper: '#ffffff' },
    text: { primary: '#111827', secondary: '#6b7280' },
    divider: '#e5e7eb',
  },
  shape: { borderRadius: 10 },
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
      styleOverrides: { root: { border: '1px solid #e5e7eb' } },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' },
      },
    },
    // Snackbars and menus float above content, so they keep a soft shadow and lose the border.
    MuiMenu: { styleOverrides: { paper: { border: 'none', boxShadow: '0 8px 24px rgba(15,17,23,0.12)' } } },
    MuiSnackbarContent: { styleOverrides: { root: { border: 'none' } } },
  },
});
