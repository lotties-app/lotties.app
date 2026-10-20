import { Outlet } from 'react-router-dom';
import { Box, Container } from '@mui/material';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';

export function AppShell() {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <Container component="main" maxWidth="md" sx={{ flexGrow: 1, py: 2, pb: 10 }}>
        <Outlet />
      </Container>
      <BottomNav />
    </Box>
  );
}
