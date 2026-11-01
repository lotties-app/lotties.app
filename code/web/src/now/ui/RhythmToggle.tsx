import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { RADIUS } from '../../theme/tokens';
import { focusRing, optionBase, palette, selectedOption } from '../../ui/form/styles';
import type { NowView } from '../ringPrefs';

const VIEWS: readonly NowView[] = ['ruler', 'ring'];

/**
 * The two views of the day on the state card: the ruler (awake window) and the ring (24 h clock).
 * Two pressed-state buttons in a group; the choice is remembered by the caller. Each target is 44 px high.
 */
export function RhythmToggle({
  view,
  onChange,
}: {
  view: NowView;
  onChange: (view: NowView) => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="group"
      aria-label={t('now.ring.view')}
      sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1 }}
    >
      {VIEWS.map((option) => {
        const selected = view === option;
        return (
          <Box
            key={option}
            component="button"
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            sx={(theme) => ({
              ...optionBase(theme),
              minHeight: 44,
              minWidth: 72,
              px: 2,
              borderRadius: `${RADIUS.pill}px`,
              backgroundColor: palette(theme).background.paper,
              fontSize: '0.8125rem',
              ...(selected && selectedOption(theme)),
              '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
            })}
          >
            {t(`now.ring.${option}`)}
          </Box>
        );
      })}
    </Box>
  );
}
