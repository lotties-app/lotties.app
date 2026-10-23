import { use } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Box, ButtonBase } from '@mui/material';
import { SelectedBabyContext } from '../baby/SelectedBabyContext';
import { useHubAttention } from '../hub/useHubAttention';
import { CONTENT_MAX_WIDTH, RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { useAddSheet } from './addSheetContext';
import { ADD_SIZE, NAV_HEIGHT, NAV_INSET } from './navMetrics';

interface NavItem {
  to: string;
  /** Catalog key under `nav`. */
  label: 'now' | 'day' | 'insights' | 'hub';
  icon: IconName;
  /** Route prefixes that mark the tab as current. */
  matches: readonly string[];
}

/** Pages reached from the Hub (and the settings it keeps): the Hub tab stays current on them. */
const HUB_ROUTES = [
  '/hub',
  '/settings',
  '/appointments',
  '/vaccines',
  '/notes',
  '/patients',
  '/proposals',
  '/from-doctor',
  '/invite',
] as const;

const ITEMS: readonly NavItem[] = [
  { to: '/', label: 'now', icon: 'clock', matches: [] },
  { to: '/day', label: 'day', icon: 'calendar', matches: ['/day'] },
  { to: '/insights', label: 'insights', icon: 'chart', matches: ['/insights'] },
  { to: '/hub', label: 'hub', icon: 'hub', matches: HUB_ROUTES },
];

function isActive(item: NavItem, pathname: string) {
  if (item.to === '/') return pathname === '/';
  return item.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function Tab({ item, active, badge = 0 }: { item: NavItem; active: boolean; badge?: number }) {
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
          position: 'relative',
          width: 48,
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
        {badge > 0 && (
          <Box
            component="span"
            data-testid="hub-tab-dot"
            sx={(theme) => ({
              position: 'absolute',
              top: 0,
              insetInlineEnd: 6,
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: palette(theme).primary.main,
              boxShadow: `0 0 0 2px ${palette(theme).background.paper}`,
              '[data-dark] &': { boxShadow: `0 0 0 2px ${palette(theme).surfaceRaised}` },
            })}
          />
        )}
      </Box>
      {t(`nav.${item.label}`)}
      {badge > 0 && (
        <Box component="span" sx={visuallyHidden}>
          {t('hub.tabBadge', { count: badge })}
        </Box>
      )}
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
      data-testid="quick-add"
      sx={(theme) => ({
        flex: '0 0 auto',
        width: ADD_SIZE,
        height: ADD_SIZE,
        pointerEvents: 'auto',
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
 * The floating dock: Now, Day, Insights and Hub as one rounded pill, and, apart from it at the
 * bottom right, a round "+" (quick add) that opens the More sheet from any tab. The "+" is absent
 * for people who cannot log (Viewer, Doctor): the dock then takes the whole width. Both are inset
 * from the edges and sit above the home indicator; the dock's elevation is a soft shadow in light,
 * the raised surface in dark and flat in the night scheme.
 */
export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const add = useAddSheet();
  const withAdd = add?.enabled === true;
  // The Hub tab carries a dot while something there waits for a look (vaccines due, doctor inbox...).
  const attention = useHubAttention(use(SelectedBabyContext)?.baby).total;

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
        sx={{
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH - 32,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Box
          component="nav"
          aria-label={t('nav.main')}
          sx={(theme) => ({
            pointerEvents: 'auto',
            flex: '1 1 0',
            minWidth: 0,
            height: NAV_HEIGHT,
            px: 0.5,
            display: 'grid',
            alignItems: 'center',
            // Equal tab columns (minmax keeps a longer label from widening its column).
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            borderRadius: `${RADIUS.pill}px`,
            // Light floats on a soft shadow; dark and night use the raised surface, night flat.
            backgroundColor: palette(theme).background.paper,
            boxShadow: palette(theme).navShadow,
            '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
          })}
        >
          {ITEMS.map((item) => (
            <Tab
              key={item.to}
              item={item}
              active={isActive(item, pathname)}
              badge={item.label === 'hub' ? attention : 0}
            />
          ))}
        </Box>
        {withAdd && <AddButton onPress={add.request} />}
      </Box>
    </Box>
  );
}
