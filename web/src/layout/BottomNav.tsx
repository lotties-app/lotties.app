import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Box, ButtonBase } from '@mui/material';
import { CONTENT_MAX_WIDTH, RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { useAddSheet } from './addSheetContext';
import { NAV_HEIGHT, NAV_INSET } from './navMetrics';

interface NavItem {
  to: string;
  /** Catalog key under `nav`. */
  label: 'now' | 'day' | 'insights';
  icon: IconName;
  /** Route prefixes that mark the tab as current. */
  matches: readonly string[];
}

const ITEMS: readonly NavItem[] = [
  { to: '/', label: 'now', icon: 'clock', matches: [] },
  { to: '/day', label: 'day', icon: 'calendar', matches: ['/day'] },
  { to: '/insights', label: 'insights', icon: 'chart', matches: ['/insights'] },
];

/** Size of the round "Add event" button. */
const ADD_SIZE = 56;

function isActive(item: NavItem, pathname: string) {
  if (item.to === '/') return pathname === '/';
  return item.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useTranslation();
  return (
    <Box
      component={Link}
      to={item.to}
      aria-current={active ? 'page' : undefined}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        minHeight: 48,
        minWidth: 44,
        textDecoration: 'none',
        fontSize: '0.75rem',
        fontWeight: active ? 650 : 500,
        color: active ? palette(theme).text.primary : palette(theme).text.secondary,
        borderRadius: `${RADIUS.pill}px`,
        '&:focus-visible': {
          outline: `2px solid ${palette(theme).primary.main}`,
          outlineOffset: -2,
        },
      })}
    >
      <Box
        data-active-indicator={active ? 'true' : undefined}
        sx={(theme) => ({
          width: 52,
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
      {t(`nav.${item.label}`)}
    </Box>
  );
}

function AddButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <ButtonBase
      onClick={onPress}
      aria-label={t('nav.add')}
      aria-haspopup="dialog"
      sx={(theme) => ({
        justifySelf: 'center',
        width: ADD_SIZE,
        height: ADD_SIZE,
        borderRadius: '50%',
        backgroundColor: palette(theme).primary.main,
        color: palette(theme).primary.contrastText,
        boxShadow: `0 6px 14px color-mix(in srgb, ${palette(theme).primary.main} 38%, transparent)`,
        // Night is flat and warm: no lift.
        '[data-night] &': { boxShadow: 'none' },
        '&:focus-visible': {
          outline: `2px solid ${palette(theme).text.primary}`,
          outlineOffset: 3,
        },
        '@media (forced-colors: active)': { border: '2px solid ButtonText' },
      })}
    >
      <Icon name="add" size={32} />
    </ButtonBase>
  );
}

/**
 * The floating pill navigation: Now, Day, a round "+" that opens the More sheet from any tab
 * (hidden when the person cannot log) and Insights. The pill is inset from the edges and sits
 * above the home indicator; its elevation is a soft shadow in light, the raised surface in dark
 * and flat in the night scheme. Settings and the baby profile live in the header menu.
 */
export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const add = useAddSheet();
  const withAdd = add?.enabled === true;
  const [now, day, insights] = ITEMS;

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
        aria-label={t('nav.main')}
        sx={(theme) => ({
          pointerEvents: 'auto',
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH - 32,
          height: NAV_HEIGHT,
          px: 1,
          display: 'grid',
          alignItems: 'center',
          gridTemplateColumns: withAdd ? `1fr 1fr ${ADD_SIZE + 16}px 1fr` : 'repeat(3, 1fr)',
          borderRadius: `${RADIUS.pill}px`,
          // Light floats on a soft shadow; dark and night use the raised surface, night flat.
          backgroundColor: palette(theme).background.paper,
          boxShadow: palette(theme).navShadow,
          '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
        })}
      >
        <Tab item={now} active={isActive(now, pathname)} />
        <Tab item={day} active={isActive(day, pathname)} />
        {withAdd && <AddButton onPress={add.request} />}
        <Tab item={insights} active={isActive(insights, pathname)} />
      </Box>
    </Box>
  );
}
