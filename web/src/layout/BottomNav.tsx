import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { BottomNavigationAction, Box, Fab, Paper } from '@mui/material';
import { canWrite } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { CONTENT_MAX_WIDTH } from '../theme/tokens';
import { TrackSheet } from '../track/TrackSheet';
import { Icon } from '../ui/Icon';

interface NavItem {
  to: string;
  /** Catalog key under `nav`. */
  label: 'home' | 'timeline' | 'growth' | 'settings';
  icon: ReactElement;
}

const START: NavItem[] = [
  { to: '/', label: 'home', icon: <Icon name="home" /> },
  { to: '/timeline', label: 'timeline', icon: <Icon name="timeline" /> },
];
const END: NavItem[] = [
  { to: '/growth', label: 'growth', icon: <Icon name="chart" /> },
  { to: '/settings', label: 'settings', icon: <Icon name="settings" /> },
];

function isActive(item: NavItem, pathname: string) {
  return item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
}

function NavLinks({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const { t } = useTranslation();
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
        label={t(`nav.${item.label}`)}
        icon={item.icon}
      />
    );
  });
}

/** Home, Timeline, a raised "Add event" action in the middle, Growth, Settings. */
export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { baby } = useSelectedBaby();
  const [trackOpen, setTrackOpen] = useState(false);
  const canTrack = baby !== undefined && canWrite(baby);

  return (
    <>
      <Paper
        component="nav"
        aria-label={t('nav.main')}
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
                aria-label={t('nav.addEvent')}
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
                {trackOpen ? <Icon name="close" /> : <Icon name="add" />}
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
