import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import type { BabyEvent, EventType, Medication, Prescription } from '../db/models';
import { useDeleteRequestResponse } from '../events/useDeleteRequestResponse';
import { useEventTypeText } from '../i18n/eventTypeText';
import { formatTime } from '../i18n/format';
import { SheetFrame } from '../now/ui/SheetFrame';
import { presentEvent } from '../timeline/eventPresentation';
import { RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { EventIllustration } from '../ui/illustrations/EventIllustration';
import { QuickTimeForm } from './QuickTimeForm';
import { quickTimeAllowed } from './quickTime';
import { isInstantEvent } from './ribbonText';

interface Props {
  /** The entry the menu is for; `null` closes it. */
  event: BabyEvent | null;
  type: EventType | undefined;
  medications: Medication[];
  prescriptions?: Prescription[];
  /** Whether the user may edit or delete it; otherwise the menu only offers View. */
  canChange: boolean;
  /** Opens the entry: the edit sheet, or the read-only one for an entry the user may not change. */
  onOpen: (event: BabyEvent) => void;
  /** Stop of a running entry the user may change; omitted when the user may not stop it. */
  onStop?: (event: BabyEvent) => void;
  onClose: () => void;
}

function Action({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 56,
        px: 1.5,
        borderRadius: `${RADIUS.input}px`,
        justifyContent: 'flex-start',
        textAlign: 'start',
        backgroundColor: palette(theme).surfaceRaised,
        color: danger ? theme.palette.error.main : 'inherit',
        font: 'inherit',
      })}
    >
      <Icon name={icon} size={20} />
      <Box component="span" sx={{ flexGrow: 1, minWidth: 0 }}>
        {label}
      </Box>
    </ButtonBase>
  );
}

/** "08:10 – 09:00", "Since 08:10" or "08:10": the times as the row shows them. */
function useTimeText(event: BabyEvent, type: EventType | undefined) {
  const { t } = useTranslation();
  const time = formatTime(event.startedAt);
  if (event.endedAt === null) return t('timeline.since', { time });
  if (isInstantEvent(event, type)) return time;
  return `${time} – ${formatTime(event.endedAt)}`;
}

function MenuBody({
  event,
  type,
  medications,
  prescriptions,
  canChange,
  onOpen,
  onStop,
  onClose,
}: Omit<Props, 'event'> & { event: BabyEvent }) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const deletion = useDeleteRequestResponse(() => type);
  const [timing, setTiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = presentEvent(event, type, medications, names, prescriptions);
  const timeText = useTimeText(event, type);

  const openAndClose = () => {
    onClose();
    onOpen(event);
  };
  const changeTime = () => {
    // A bottle's history, pauses or nursing sides move with the times: the full sheet owns them.
    if (quickTimeAllowed(event)) setTiming(true);
    else openAndClose();
  };
  const remove = async () => {
    try {
      await deletion.approve(event);
      onClose();
    } catch (e) {
      setError(describeApiError(e));
    }
  };

  const title = timing ? t('day.rowMenu.changeTime') : view.title;
  const subtitle = timing ? `${view.title} · ${timeText}` : timeText;
  return (
    <SheetFrame
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      leading={<EventIllustration type={type} payload={event.payload} size={40} />}
    >
      {timing ? (
        <QuickTimeForm event={event} onSaved={onClose} onCancel={() => setTiming(false)} />
      ) : (
        <Box role="group" aria-label={t('day.rowMenu.actions')} sx={{ display: 'grid', gap: 1 }}>
          {canChange ? (
            <>
              <Action icon="edit" label={t('common.edit')} onClick={openAndClose} />
              <Action icon="clock" label={t('day.rowMenu.changeTime')} onClick={changeTime} />
              {event.endedAt === null && onStop && (
                <Action
                  icon="stop"
                  label={t('day.rowMenu.stop')}
                  onClick={() => {
                    onClose();
                    onStop(event);
                  }}
                />
              )}
              <Action
                icon="delete"
                label={t('common.delete')}
                danger
                onClick={() => void remove()}
              />
            </>
          ) : (
            <Action icon="eye" label={t('day.rowMenu.view')} onClick={openAndClose} />
          )}
          {error && (
            <Typography role="alert" color="error" variant="body2">
              {error}
            </Typography>
          )}
        </Box>
      )}
    </SheetFrame>
  );
}

/**
 * The action menu of a Day row (docs/design/03-interaction.md, "Press and hold a Day row"), a
 * bottom sheet headed by the entry and its time: Edit (as a tap), Change time (the quick time
 * sheet, or the full sheet for an entry whose payload follows its times), Stop for a running entry
 * and Delete (the usual soft delete with Undo, no confirmation). For an entry the user may not
 * change, only View (the read-only sheet).
 */
export function DayRowMenu({ event, ...rest }: Props) {
  if (!event) return null;
  return <MenuBody key={event.id} event={event} {...rest} />;
}
