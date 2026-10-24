import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { formatTime } from '../../i18n/format';
import { RADIUS } from '../../theme/tokens';
import { focusRing, palette } from '../../ui/form/styles';
import type { RhythmText } from '../rhythmDetails';
import type { UpcomingItem } from '../upcoming';
import { LaneStamp } from './LaneStamp';
import { upcomingVisual } from './upcomingVisual';

/** Rows shown before "Show all". */
export const LIST_COLLAPSED = 3;

export interface UpcomingRow {
  item: UpcomingItem;
  text: RhythmText;
  /** The key of the marker that draws it (its own, or the cluster's). */
  markKey: string;
}

/**
 * "Next up" under the chart (docs/DESIGN.md "Now: next up on the ring"): the markers the chart
 * draws as a chronological list, with the same sentences and times, the next three first ("Show
 * all" expands). A row is a pressed-state button that selects (highlights) its marker and shows
 * its details in the strip, like tapping the marker. What screen readers read in order; it never
 * lists more than the markers show. "Nothing more expected" when a layer is on but nothing is ahead.
 */
export function UpcomingList({
  rows,
  selected,
  onSelect,
}: {
  rows: readonly UpcomingRow[];
  selected: string | null;
  onSelect: (markKey: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, LIST_COLLAPSED);
  return (
    <Box data-testid="upcoming" sx={{ width: '100%', display: 'grid', gap: 0.5 }}>
      <Typography id={titleId} variant="subtitle2" component="p" sx={{ fontWeight: 600, m: 0 }}>
        {t('now.upcoming.listTitle')}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="upcoming-nothing">
          {t('now.upcoming.nothing')}
        </Typography>
      ) : (
        <>
          <Box
            component="ul"
            id={listId}
            aria-labelledby={titleId}
            data-testid="upcoming-list"
            sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }}
          >
            {shown.map((row) => (
              <Box component="li" key={row.item.key}>
                <ButtonBase
                  aria-pressed={selected === row.markKey}
                  data-testid={`upcoming-row-${row.item.kind}`}
                  onClick={() => onSelect(row.markKey)}
                  sx={(theme) => ({
                    width: '100%',
                    minHeight: 44,
                    px: 1,
                    py: 0.75,
                    gap: 1,
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'flex-start',
                    textAlign: 'start',
                    borderRadius: `${RADIUS.input}px`,
                    '&[aria-pressed="true"]': {
                      boxShadow: `inset 0 0 0 1.5px ${palette(theme).primary.main}`,
                    },
                    '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
                    '@media (forced-colors: active)': {
                      '&[aria-pressed="true"]': { outline: '2px solid Highlight' },
                    },
                  })}
                >
                  <LaneStamp visual={upcomingVisual(row.item)} confidence={row.item.confidence} />
                  <Typography
                    variant="body2"
                    component="span"
                    aria-hidden
                    sx={{
                      flex: 'none',
                      minWidth: '3.25em',
                      fontWeight: 600,
                      lineHeight: '24px',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatTime(row.item.at)}
                  </Typography>
                  <Typography
                    variant="body2"
                    component="span"
                    sx={{ minWidth: 0, overflowWrap: 'anywhere', pt: '2px' }}
                  >
                    <Box component="span" sx={{ display: 'block' }}>
                      {row.text.title}
                    </Box>
                    {row.text.lines.length > 0 && (
                      <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                        {row.text.lines.join(' · ')}
                      </Box>
                    )}
                  </Typography>
                </ButtonBase>
              </Box>
            ))}
          </Box>
          {rows.length > LIST_COLLAPSED && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Button
                color="inherit"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => setOpen(!open)}
                sx={{ minHeight: 44, color: 'text.secondary', fontWeight: 600 }}
              >
                {open
                  ? t('now.upcoming.showFewer')
                  : t('now.upcoming.showAll', { count: rows.length })}
              </Button>
            </Box>
          )}
        </>
      )}
      <Typography variant="caption" color="text.secondary">
        {t('now.upcoming.listNote')}
      </Typography>
    </Box>
  );
}
