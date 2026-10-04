'use client';

import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#166b55' },
    secondary: { main: '#b4642f' },
    background: { default: '#f2f5f3', paper: '#ffffff' },
    text: { primary: '#18312a', secondary: '#667a73' }
  },
  typography: {
    fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    button: { textTransform: 'none', fontWeight: 700 }
  },
  shape: { borderRadius: 6 }
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
