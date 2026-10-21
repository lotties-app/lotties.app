import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import type { EventType } from '../../db/models';
import { eventTypeText } from '../../i18n/eventTypeText';
import { RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Illustration } from '../../ui/illustrations';
import { typeForKey } from '../eventFacts';
import type { DiaperTray } from '../quickLog';
import { SheetFrame } from './SheetFrame';

const CONTENT_FIELD = { key: 'content' };

const OPTION_ICON: Record<string, IconName> = {
  wet: 'droplet',
  dirty: 'poo',
  mixed: 'droplet-half',
};

interface Props {
  open: boolean;
  onClose: () => void;
  tray: DiaperTray;
  types: readonly EventType[];
  /** One tap logs: the content (`WET`, `DIRTY`, `MIXED`). */
  onChoose: (content: string) => void;
  disabled: boolean;
}

/** The Diaper tray: Wet, Dirty or Mixed, one tap logs. Never pre-selected (a wrong value costs more). */
export function DiaperTraySheet({ open, onClose, tray, types, onChoose, disabled }: Props) {
  const { t } = useTranslation();
  const type = typeForKey(types, 'diaper');
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title={t('now.diaperTray.title')}
      leading={<Illustration name="diaper" size={48} />}
    >
      <Typography variant="body2" color="text.secondary">
        {t('now.diaperTray.hint')}
      </Typography>
      <Box
        role="group"
        aria-label={t('now.diaperTray.title')}
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, tray.options.length)}, minmax(0, 1fr))`,
          gap: 1.5,
        }}
      >
        {tray.options.map((option, index) => (
          <Box
            key={option}
            component="button"
            type="button"
            autoFocus={index === 0}
            disabled={disabled}
            onClick={() => onChoose(option)}
            sx={(theme) => ({
              appearance: 'none',
              border: 0,
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: 96,
              borderRadius: `${RADIUS.tile}px`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.75,
              backgroundColor: palette(theme).category.diaper.bg,
              color: palette(theme).category.diaper.fg,
              '&:focus-visible': {
                outline: `2px solid ${palette(theme).primary.main}`,
                outlineOffset: 2,
              },
              '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
            })}
          >
            <Icon name={OPTION_ICON[option.toLowerCase()] ?? 'diaper'} size={32} />
            {type ? eventTypeText.optionLabel(type, CONTENT_FIELD, option) : option}
          </Box>
        ))}
      </Box>
    </SheetFrame>
  );
}
