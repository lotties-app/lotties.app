import { useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BottomNavigationAction, Box, Fab, Paper } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import { canWrite } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { CONTENT_MAX_WIDTH } from '../theme/tokens';
import { TrackSheet } from '../track/TrackSheet';

interface NavItem {
  to: string;
  label: string;
  icon: ReactElement;
}

const START: NavItem[] = [
  { to: '/', label: 'Home', icon: <HomeRoundedIcon /> },
  { to: '/timeline', label: 'Timeline', icon: <TimelineRoundedIcon /> },
];
const END: NavItem[] = [
  { to: '/growth', label: 'Growth', icon: <BarChartRoundedIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsRoundedIcon /> },
];

function isActive(item: NavItem, pathname: string) {
  return item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
}

function NavLinks({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return items.map((item) => {
    const active = isActive(item, pathname);
    return (
      <BottomNavigationAction
        key={item.to}
        component={Link}
        to={item.to}
        showLabel
        selected={active}
        aria-current={active ? 'page' : undefined}
        label={item.label}
        icon={item.icon}
      />
    );
  });
}

/** Home, Timeline, a raised "Add event" action in the middle, Growth, Settings. */
export function BottomNav() {
  const { pathname } = useLocation();
  const { baby } = useSelectedBaby();
  const [trackOpen, setTrackOpen] = useState(false);
  const canTrack = baby !== undefined && canWrite(baby);

  return (
    <>
      <Paper
        component="nav"
        aria-label="Main"
        elevation={0}
        square
        sx={(theme) => ({
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: theme.zIndex.appBar,
          borderTop: 1,
          borderColor: 'divider',
          pb: 'env(safe-area-inset-bottom)',
        })}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 72px 1fr 1fr',
            alignItems: 'center',
            maxWidth: CONTENT_MAX_WIDTH,
            mx: 'auto',
            height: 64,
          }}
        >
          <NavLinks items={START} pathname={pathname} />
          <Box sx={{ position: 'relative', height: '100%' }}>
            {canTrack && (
              <Fab
                color="primary"
                aria-label="Add event"
                aria-haspopup="dialog"
                aria-expanded={trackOpen}
                onClick={() => setTrackOpen((open) => !open)}
                sx={{
                  position: 'absolute',
                  top: -20,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 56,
                  height: 56,
                }}
              >
                {trackOpen ? <CloseRoundedIcon /> : <AddRoundedIcon />}
              </Fab>
            )}
          </Box>
          <NavLinks items={END} pathname={pathname} />
        </Box>
      </Paper>
      {canTrack && <TrackSheet open={trackOpen} onClose={() => setTrackOpen(false)} baby={baby} />}
    </>
  );
}
