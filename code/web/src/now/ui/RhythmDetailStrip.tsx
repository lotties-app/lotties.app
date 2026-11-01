import { useTranslation } from 'react-i18next';
import { Box, IconButton, Typography } from '@mui/material';
import { RADIUS } from '../../theme/tokens';
import { Icon } from '../../ui/Icon';
import { palette } from '../../ui/form/styles';
import type { RhythmText } from '../rhythmDetails';

/**
 * The quiet line under the ring or the ruler with the selected mark's details ("Nap window opens
 * 15:50, closes 16:39 · Opens in 1h 20m · Based on ..."), and a button that clears it. The text is
 * a polite live region that stays mounted (empty, taking no room) while nothing is selected, so
 * the default view is unchanged and a new selection is announced.
 */
export function RhythmDetailStrip({
  text,
  onClear,
}: {
  text: RhythmText | null;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="rhythm-strip"
      sx={(theme) => ({
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        ...(text
          ? {
              pl: 1.5,
              pr: 0.25,
              py: 0.25,
              borderRadius: `${RADIUS.input}px`,
              border: `1px solid ${palette(theme).hairline}`,
            }
          : {}),
      })}
    >
      <Box
        role="status"
        aria-atomic="true"
        data-testid="rhythm-detail"
        sx={{ flex: '1 1 auto', minWidth: 0 }}
      >
        {text && (
          <Typography
            variant="body2"
            sx={{ overflowWrap: 'anywhere', fontVariantNumeric: 'lining-nums tabular-nums' }}
          >
            <Box component="span" sx={{ fontWeight: 600 }}>
              {text.title}
            </Box>
            {text.lines.length > 0 && (
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {` · ${text.lines.join(' · ')}`}
              </Box>
            )}
          </Typography>
        )}
      </Box>
      {text && (
        <IconButton
          aria-label={t('now.rhythm.clear')}
          onClick={onClear}
          sx={{ width: 44, height: 44, flexShrink: 0, color: 'text.secondary' }}
        >
          <Icon name="close" size={20} />
        </IconButton>
      )}
    </Box>
  );
}
