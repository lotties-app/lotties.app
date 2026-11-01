import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Skeleton, Typography } from '@mui/material';
import { formatNumber } from '../i18n/format';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { palette, selectedOption } from '../ui/form/styles';
import type { BoardTotals } from './boardApi';
import {
  DEFAULT_FILTERS,
  isShortcutActive,
  shortcutFilters,
  SUMMARY_SHORTCUTS,
  type BoardFilters,
  type SummaryShortcut,
} from './boardQuery';

interface Props {
  totals: BoardTotals | undefined;
  filters: BoardFilters;
  onApply: (filters: BoardFilters) => void;
}

/**
 * The summary strip (`GET /board/summary`): waiting on the owner, waiting on the assistant,
 * blocked and due soon (the next 7 days). Each is a toggle that applies its filter (pressed while it is the filter);
 * pressing it again goes back to the plain board.
 */
export function SummaryStrip({ totals, filters, onApply }: Props) {
  const { t } = useTranslation();
  const valueOf = (shortcut: SummaryShortcut) => totals?.[shortcut] ?? 0;
  return (
    <Box component="section" aria-labelledby="board-summary-title">
      <Typography component="h2" id="board-summary-title" sx={visuallyHidden}>
        {t('board.summary.title')}
      </Typography>
      <Box
        component="ul"
        sx={{
          m: 0,
          p: 0,
          display: 'grid',
          gap: 1,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
        }}
      >
        {SUMMARY_SHORTCUTS.map((shortcut) => {
          const active = isShortcutActive(shortcut, filters);
          return (
            <Box component="li" key={shortcut} sx={{ listStyle: 'none', minWidth: 0 }}>
              <ButtonBase
                aria-pressed={active}
                data-testid={`board-summary-${shortcut}`}
                onClick={() => onApply(active ? DEFAULT_FILTERS : shortcutFilters(shortcut))}
                sx={(theme) => ({
                  width: '100%',
                  minHeight: 64,
                  px: 1.5,
                  py: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  textAlign: 'start',
                  borderRadius: '16px',
                  backgroundColor: palette(theme).background.paper,
                  boxShadow: palette(theme).cardShadow,
                  ...(active && selectedOption(theme)),
                  '&:focus-visible': {
                    outline: `2px solid ${palette(theme).primary.main}`,
                    outlineOffset: 2,
                  },
                })}
              >
                {totals ? (
                  <Typography
                    component="span"
                    sx={{
                      fontSize: '1.5rem',
                      fontWeight: 600,
                      lineHeight: 1.2,
                      fontFeatureSettings: '"tnum"',
                      color:
                        valueOf(shortcut) > 0 && shortcut === 'blocked' ? 'error.main' : undefined,
                    }}
                  >
                    {formatNumber(valueOf(shortcut))}
                  </Typography>
                ) : (
                  <Skeleton variant="text" width={32} sx={{ fontSize: '1.5rem' }} />
                )}
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  {t(`board.summary.${shortcut}`)}
                </Typography>
              </ButtonBase>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
