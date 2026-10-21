import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Box, Paper } from '@mui/material';
import { CONTENT_MAX_WIDTH, RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';

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

function isActive(item: NavItem, pathname: string) {
  if (item.to === '/') return pathname === '/';
  return item.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Now, Day and Insights, with a pill behind the current tab's icon. The bar sits above the home
 * indicator (safe-area inset). Settings and the baby profile live in the header menu.
 */
export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
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
          gridTemplateColumns: 'repeat(3, 1fr)',
          maxWidth: CONTENT_MAX_WIDTH,
          mx: 'auto',
          height: 64,
        }}
      >
        {ITEMS.map((item) => {
          const active = isActive(item, pathname);
          return (
            <Box
              key={item.to}
              component={Link}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              sx={(theme) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.25,
                minHeight: 56,
                textDecoration: 'none',
                fontSize: '0.75rem',
                fontWeight: active ? 650 : 500,
                color: active ? palette(theme).text.primary : palette(theme).text.secondary,
                '&:focus-visible': {
                  outline: `2px solid ${palette(theme).primary.main}`,
                  outlineOffset: -2,
                },
              })}
            >
              <Box
                data-active-indicator={active ? 'true' : undefined}
                sx={(theme) => ({
                  width: 56,
                  height: 30,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: `${RADIUS.pill}px`,
                  backgroundColor: active ? palette(theme).surfaceRaised : 'transparent',
                  color: active ? palette(theme).primary.main : 'inherit',
                })}
              >
                <Icon name={item.icon} size={24} />
              </Box>
              {t(`nav.${item.label}`)}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
