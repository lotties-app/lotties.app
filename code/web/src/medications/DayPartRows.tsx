import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { Icon } from '../ui/Icon';
import { dayPartName, slotStateText } from './dayPartText';
import type { DayPartSlot, DayPartState, DayPartsStatus } from './statusCalculator';

const STATE_ICON = { given: 'check', due: 'clock', upcoming: 'clock', missed: 'minus' } as const;

function Row({ slot, now }: { slot: DayPartSlot; now: Date }) {
  const state: DayPartState = slot.state;
  return (
    <Box
      role="listitem"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        fontSize: '0.8125rem',
        fontWeight: state === 'due' ? 600 : 400,
        color: state === 'due' || state === 'given' ? 'text.primary' : 'text.secondary',
      }}
    >
      <Icon name={STATE_ICON[state]} size={16} />
      <span>{dayPartName(slot.part)}</span>
      <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
        {slotStateText(slot, now)}
      </Box>
    </Box>
  );
}

/**
 * Today's parts of a part-of-the-day prescription on its Meds tray card: "Morning · Given at
 * 08:12", "Night · Due until 05:00". A missed part is shown as information only ("Not logged").
 */
export function DayPartRows({ parts, now }: { parts: DayPartsStatus; now: Date }) {
  const { t } = useTranslation();
  if (parts.parts.length === 0) return null;
  return (
    <Box
      role="list"
      aria-label={t('medications.parts.listLabel')}
      sx={{ display: 'grid', gap: 0.5 }}
    >
      {parts.parts.map((slot) => (
        <Row key={`${slot.day}-${slot.part}`} slot={slot} now={now} />
      ))}
    </Box>
  );
}
