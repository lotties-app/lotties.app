import { Link, useLocation } from 'react-router-dom';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import TimelineIcon from '@mui/icons-material/Timeline';
import SettingsIcon from '@mui/icons-material/Settings';

const ITEMS = [
  { to: '/', label: 'Home', icon: <HomeIcon /> },
  { to: '/timeline', label: 'Timeline', icon: <TimelineIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function BottomNav() {
  const { pathname } = useLocation();
  const active = ITEMS.find((i) => i.to !== '/' && pathname.startsWith(i.to))?.to ?? '/';

  return (
    <Paper
      component="nav"
      elevation={3}
      sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: (t) => t.zIndex.appBar }}
    >
      <BottomNavigation showLabels value={active} sx={{ height: 64 }}>
        {ITEMS.map((item) => (
          <BottomNavigationAction
            key={item.to}
            component={Link}
            to={item.to}
            value={item.to}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
