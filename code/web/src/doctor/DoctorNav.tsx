import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Box, Tooltip } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { NAV_HEIGHT, NAV_INSET } from '../layout/navMetrics';
import { useBottomNavSpace } from '../layout/useBottomNavSpace';
import { patientPath } from './dashboardStorage';
import { activeNavKey, RAIL_WIDTH, type NavKey } from './navModel';

interface NavItem {
  key: NavKey;
  icon: IconName;
}

const ITEMS: readonly NavItem[] = [
  { key: 'patients', icon: 'users' },
  { key: 'summary', icon: 'chart' },
  { key: 'timeline', icon: 'timeline' },
  { key: 'growth', icon: 'ruler' },
  { key: 'medications', icon: 'pill' },
  { key: 'notes', icon: 'note' },
];

function targetOf(item: NavItem, patientId: string | null): string | null {
  if (item.key === 'patients') return '/doctor';
  return patientId ? patientPath(patientId, item.key) : null;
}

function NavButton({
  item,
  to,
  active,
  rail,
}: {
  item: NavItem;
  to: string | null;
  active: boolean;
  rail: boolean;
}) {
  const { t } = useTranslation();
  const label = t(`doctorDashboard.nav.${item.key}`);
  const common = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.25,
    minHeight: rail ? 64 : 48,
    minWidth: 0,
    width: '100%',
    px: 0.25,
    textDecoration: 'none',
    fontSize: rail ? '0.75rem' : '0.6875rem',
    lineHeight: 1.2,
    textAlign: 'center',
    borderRadius: `${RADIUS.tile}px`,
  } as const;
  const indicator = (
    <Box
      data-active-indicator={active ? 'true' : undefined}
      sx={(theme) => ({
        width: rail ? 56 : 44,
        height: 28,
        display: 'grid',
        placeItems: 'center',
        borderRadius: `${RADIUS.pill}px`,
        backgroundColor: active
          ? `color-mix(in srgb, ${palette(theme).primary.main} 16%, transparent)`
          : 'transparent',
        color: active ? palette(theme).primary.main : 'inherit',
      })}
    >
      <Icon name={item.icon} size={24} />
    </Box>
  );
  const text = (
    <Box
      component="span"
      sx={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >
      {label}
    </Box>
  );
  if (!to) {
    // No patient opened yet: the section is shown but cannot be followed.
    return (
      <Tooltip title={t('doctorDashboard.nav.needsPatient')}>
        <Box
          component="span"
          role="link"
          aria-disabled="true"
          aria-label={`${label}. ${t('doctorDashboard.nav.needsPatient')}`}
          tabIndex={0}
          sx={(theme) => ({ ...common, color: palette(theme).text.secondary, opacity: 0.55 })}
        >
          {indicator}
          {text}
        </Box>
      </Tooltip>
    );
  }
  return (
    <Box
      component={Link}
      to={to}
      aria-current={active ? 'page' : undefined}
      sx={(theme) => ({
        ...common,
        fontWeight: active ? 650 : 500,
        color: active ? palette(theme).text.primary : palette(theme).text.secondary,
        '&:focus-visible': {
          outline: `2px solid ${palette(theme).primary.main}`,
          outlineOffset: -2,
        },
      })}
    >
      {indicator}
      {text}
    </Box>
  );
}

/**
 * The doctor's own navigation (docs/design/19-doctor-dashboard.md): Patients, then the sections of
 * the open patient (or the last one opened). A floating pill at the bottom on phones, a left rail
 * on wide screens; no "add" button: the doctor never logs the family's entries.
 */
export function DoctorNav({ patientId, rail }: { patientId: string | null; rail: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = activeNavKey(pathname);
  // The rail is beside the content: only the bottom dock lifts the snackbars.
  useBottomNavSpace(!rail);
  const buttons = ITEMS.map((item) => (
    <NavButton
      key={item.key}
      item={item}
      to={targetOf(item, patientId)}
      active={active === item.key}
      rail={rail}
    />
  ));

  if (rail) {
    return (
      <Box
        component="nav"
        aria-label={t('doctorDashboard.nav.label')}
        sx={(theme) => ({
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          width: RAIL_WIDTH,
          pt: 'calc(env(safe-area-inset-top) + 88px)',
          px: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          zIndex: theme.zIndex.appBar,
          backgroundColor: palette(theme).background.paper,
          borderRight: `1px solid ${palette(theme).hairline}`,
          '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
        })}
      >
        {buttons}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        display: 'flex',
        justifyContent: 'center',
        px: 2,
        pb: `calc(${NAV_INSET}px + env(safe-area-inset-bottom))`,
        pointerEvents: 'none',
      }}
    >
      <Box
        component="nav"
        aria-label={t('doctorDashboard.nav.label')}
        sx={(theme) => ({
          pointerEvents: 'auto',
          width: '100%',
          maxWidth: 560,
          height: NAV_HEIGHT,
          px: 0.5,
          display: 'grid',
          alignItems: 'center',
          gridTemplateColumns: `repeat(${ITEMS.length}, minmax(0, 1fr))`,
          borderRadius: `${RADIUS.pill}px`,
          backgroundColor: palette(theme).background.paper,
          boxShadow: palette(theme).navShadow,
          '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
        })}
      >
        {buttons}
      </Box>
    </Box>
  );
}
