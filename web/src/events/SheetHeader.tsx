import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  ButtonBase,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import type { EventPayload, EventType } from '../db/models';
import { useEventTypeText } from '../i18n/eventTypeText';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { EventIllustration } from '../ui/illustrations';

/** The moment shown large in the header: the clock and the day it falls on. */
export interface HeaderTime {
  /** `14:20` */
  clock: string;
  /** `Today`, `Yesterday` or a date. */
  day: string;
}

interface Props {
  titleId: string;
  type: EventType | undefined;
  /** What the event holds (the sleep kind, the feeding method), for the right illustration. */
  payload?: EventPayload;
  /** Replaces the type name (the "Finish this ..." title). */
  title?: string;
  subtitle: string;
  /** The start time as a large serif numeral beside "Today". */
  time?: HeaderTime;
  /** Moves focus to the time field below (the large time is a button for it). */
  onEditTime?: () => void;
  /** The types the name switches between; omit for a fixed type. */
  types?: readonly EventType[];
  onChangeType?: (type: EventType) => void;
  onClose: () => void;
  /** Adds the overflow menu with Delete. */
  onDelete?: () => void;
}

function TypeMenu({
  anchor,
  types,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  types: readonly EventType[];
  current: string | undefined;
  onPick: (type: EventType) => void;
  onClose: () => void;
}) {
  const names = useEventTypeText();
  return (
    <Menu anchorEl={anchor} open={anchor !== null} onClose={onClose}>
      {types.map((candidate) => (
        <MenuItem
          key={candidate.id}
          selected={candidate.id === current}
          onClick={() => {
            onClose();
            onPick(candidate);
          }}
          sx={{ minHeight: 48, gap: 1.5 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            <EventIllustration type={candidate} size={32} />
          </ListItemIcon>
          {names.typeName(candidate)}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** The large time of the hero: tapping it moves to the time field. */
function HeroTime({ time, onEdit }: { time: HeaderTime; onEdit?: () => void }) {
  const { t } = useTranslation();
  return (
    <ButtonBase
      onClick={onEdit}
      aria-label={t('events.sheet.editTime', { time: time.clock, day: time.day })}
      data-testid="sheet-hero-time"
      sx={(theme) => ({
        alignItems: 'baseline',
        justifyContent: 'flex-start',
        gap: 1,
        minHeight: 44,
        borderRadius: 2,
        color: palette(theme).text.primary,
        textAlign: 'start',
      })}
    >
      <Typography
        component="span"
        sx={{
          fontFamily: (theme) => theme.typography.fontFamilyDisplay,
          fontSize: '2.5rem',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums lining-nums',
        }}
      >
        {time.clock}
      </Typography>
      <Typography component="span" variant="subtitle2" color="text.secondary">
        {time.day}
      </Typography>
    </ButtonBase>
  );
}

/**
 * Top of the event sheet: close (X) at the left and the overflow menu (Delete) at the right, then
 * the hero: the large illustration of the event (soft glow in light and dark, flat in night), the
 * type name (a button that opens the type list when the type can change) with a quiet subtitle,
 * and the start time as a large serif numeral beside "Today". The heading names the dialog.
 */
export function SheetHeader({
  titleId,
  type,
  payload,
  title,
  subtitle,
  time,
  onEditTime,
  types,
  onChangeType,
  onClose,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const menuId = useId();
  const [typeAnchor, setTypeAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const name = title ?? (type ? names.typeName(type) : t('common.event'));
  const switchable = !!types && types.length > 1 && !!onChangeType;

  const label = (
    <>
      <span>{name}</span>
      {switchable && <Icon name="expand" size={20} />}
    </>
  );
  return (
    <Box sx={{ px: 1.5, pt: 1, pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton
          onClick={onClose}
          aria-label={t('now.sheet.close')}
          sx={{ width: 48, height: 48 }}
        >
          <Icon name="close" />
        </IconButton>
        {onDelete && (
          <>
            <IconButton
              onClick={(e) => setMoreAnchor(e.currentTarget)}
              aria-label={t('events.sheet.moreActions')}
              aria-haspopup="menu"
              aria-controls={moreAnchor ? menuId : undefined}
              sx={{ width: 48, height: 48 }}
            >
              <Icon name="more" />
            </IconButton>
            <Menu
              id={menuId}
              anchorEl={moreAnchor}
              open={moreAnchor !== null}
              onClose={() => setMoreAnchor(null)}
            >
              <MenuItem
                onClick={() => {
                  setMoreAnchor(null);
                  onDelete();
                }}
                sx={{ minHeight: 48, gap: 1.5, color: 'error.main' }}
              >
                <Icon name="delete" />
                {t('common.delete')}
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1, pb: 0.5 }}>
        <EventIllustration type={type} payload={payload} size={64} glow />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography id={titleId} variant="h5" component="h2" sx={{ lineHeight: 1.2 }}>
            {switchable ? (
              <ButtonBase
                aria-haspopup="menu"
                aria-expanded={typeAnchor !== null}
                title={t('events.sheet.changeType')}
                onClick={(e) => setTypeAnchor(e.currentTarget)}
                sx={{
                  font: 'inherit',
                  color: 'inherit',
                  gap: 0.5,
                  minHeight: 44,
                  borderRadius: 2,
                  textAlign: 'start',
                  maxWidth: '100%',
                  '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 2 },
                }}
              >
                {label}
              </ButtonBase>
            ) : (
              name
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p">
            {subtitle}
          </Typography>
          {time && <HeroTime time={time} onEdit={onEditTime} />}
        </Box>
      </Box>
      {switchable && types && onChangeType && (
        <TypeMenu
          anchor={typeAnchor}
          types={types}
          current={type?.id}
          onPick={onChangeType}
          onClose={() => setTypeAnchor(null)}
        />
      )}
    </Box>
  );
}
