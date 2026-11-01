import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import type { BabyEvent, EventType, Medication, Prescription } from '../db/models';
import type { EntitySyncState } from '../db/queries';
import { formatElapsed, useNow } from '../events/time';
import { useEventTypeText } from '../i18n/eventTypeText';
import { formatDuration, formatTime } from '../i18n/format';
import { presentEvent } from '../timeline/eventPresentation';
import { RADIUS } from '../theme/tokens';
import {
  effectiveDurationMs,
  effectiveElapsedSeconds,
  isPaused,
  readPause,
} from '../timers/pauseMath';
import { EventIllustration } from '../ui/illustrations/EventIllustration';
import { Icon } from '../ui/Icon';
import { palette } from '../ui/form/styles';

interface Props {
  event: BabyEvent;
  type: EventType | undefined;
  medications: Medication[];
  /** Prescriptions of the baby, deleted ones included (they name logged doses). */
  prescriptions?: Prescription[];
  syncState: EntitySyncState | undefined;
  /** Whether the connecting line continues below this row. */
  hasNext: boolean;
  onEdit: (event: BabyEvent) => void;
  /** Stop action of a running event; omitted when the viewer cannot write. */
  onStop?: (event: BabyEvent) => void;
  /** Viewers can look but not edit. */
  readOnly?: boolean;
}

/** Instant events (no duration type, or ending when they start) have no length to show. */
const isInstant = (event: BabyEvent, type: EventType | undefined) =>
  type?.hasDuration === false || event.endedAt === event.startedAt;

/** The live clock of a running event: effective time, so a paused timer stands still. */
function LiveTimer({ event }: { event: BabyEvent }) {
  const now = useNow(1000);
  return (
    <Typography
      component="span"
      sx={{
        fontFamily: (theme) => theme.typography.h5.fontFamily,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {formatElapsed(effectiveElapsedSeconds(event, now) * 1000)}
    </Typography>
  );
}

function SyncMark({ state }: { state: EntitySyncState | undefined }) {
  const { t } = useTranslation();
  if (!state) return null;
  if (state === 'dead') {
    return (
      <Box
        component="span"
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.25,
          borderRadius: `${RADIUS.pill}px`,
          fontSize: '0.75rem',
          fontWeight: 600,
          backgroundColor: palette(theme).category.health.bg,
          color: palette(theme).category.health.fg,
        })}
      >
        <Icon name="error" size={16} />
        {t('day.needsAttention')}
      </Box>
    );
  }
  return (
    <Box
      role="img"
      aria-label={t('timeline.notSynced')}
      title={t('timeline.notSynced')}
      sx={(theme) => ({
        width: 8,
        height: 8,
        borderRadius: '50%',
        flexShrink: 0,
        boxShadow: `inset 0 0 0 1.5px ${palette(theme).text.secondary}`,
      })}
    />
  );
}

function RunningPill({ event }: { event: BabyEvent }) {
  const { t } = useTranslation();
  const paused = isPaused(event);
  return (
    <Box sx={{ display: 'grid', justifyItems: 'end', lineHeight: 1.1 }}>
      <Box
        component="span"
        sx={(theme) => ({
          px: 1,
          borderRadius: `${RADIUS.pill}px`,
          fontSize: '0.75rem',
          fontWeight: 700,
          backgroundColor: paused ? palette(theme).surfaceRaised : palette(theme).primary.main,
          color: paused ? palette(theme).text.secondary : palette(theme).primary.contrastText,
          boxShadow: paused ? `inset 0 0 0 1px ${palette(theme).hairline}` : 'none',
        })}
      >
        {paused ? t('timers.paused') : t('common.running')}
      </Box>
      <LiveTimer event={event} />
    </Box>
  );
}

function DurationPill({ text, pausedText }: { text: string; pausedText?: string }) {
  return (
    <Box sx={{ display: 'grid', justifyItems: 'end', gap: 0.25 }}>
      <Box
        component="span"
        sx={(theme) => ({
          px: 1.25,
          py: 0.25,
          borderRadius: `${RADIUS.pill}px`,
          fontSize: '0.8125rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          backgroundColor: palette(theme).background.paper,
          boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
        })}
      >
        {text}
      </Box>
      {pausedText && (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {pausedText}
        </Typography>
      )}
    </Box>
  );
}

function ConnectingLine() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: 'absolute',
        top: 44,
        bottom: -4,
        width: '1px',
        backgroundColor: palette(theme).hairline,
      })}
    />
  );
}

/**
 * A quiet line between rows when a nap or a night ended ("Sleep session ended, 1h 12m"): the end
 * time in the time column, the connecting line through the dot column, the text in muted type.
 */
export function SessionSeparatorRow({
  endedAt,
  durationMs,
}: {
  endedAt: string;
  durationMs: number;
}) {
  const { t } = useTranslation();
  return (
    <Box
      component="li"
      sx={{
        display: 'grid',
        gridTemplateColumns: '44px 40px minmax(0, 1fr)',
        columnGap: 1,
        listStyle: 'none',
        m: 0,
        p: 0,
        minHeight: 32,
        alignItems: 'center',
      }}
    >
      <Typography
        component="time"
        dateTime={endedAt}
        variant="caption"
        color="text.secondary"
        sx={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
      >
        {formatTime(endedAt)}
      </Typography>
      <Box
        sx={{
          position: 'relative',
          alignSelf: 'stretch',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box
          aria-hidden
          sx={(theme) => ({
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '1px',
            backgroundColor: palette(theme).hairline,
          })}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        {t('day.sessionEnded', { duration: formatDuration(durationMs) })}
      </Typography>
    </Box>
  );
}

/**
 * One event of the day: the time in a column, the event's illustration on a connecting line, and a
 * card tinted in the category colour with a coloured left edge, the title derived from the event, a detail line, the duration pill (or the live
 * "Running" timer with a Stop action) and a sync mark only for unsynced rows. Tap = edit.
 */
export function DayRow({
  event,
  type,
  medications,
  prescriptions,
  syncState,
  hasNext,
  onEdit,
  onStop,
  readOnly = false,
}: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const view = presentEvent(event, type, medications, names, prescriptions);
  const running = event.endedAt === null;
  const time = formatTime(event.startedAt);
  const instant = isInstant(event, type);
  let range = '';
  if (running) range = t('timeline.since', { time });
  else if (!instant) range = `${time} – ${formatTime(event.endedAt!)}`;
  const detail = view.detail || range;
  const length = !running && !instant ? formatDuration(effectiveDurationMs(event)) : null;
  const pausedSeconds = readPause(event.payload).pausedSeconds;
  const pausedText =
    length && pausedSeconds > 0
      ? t('day.pausedFor', { duration: formatDuration(pausedSeconds * 1000) })
      : undefined;

  return (
    <Box
      component="li"
      sx={{
        display: 'grid',
        gridTemplateColumns: '44px 40px minmax(0, 1fr)',
        columnGap: 1,
        listStyle: 'none',
        m: 0,
        p: 0,
      }}
    >
      <Typography
        component="time"
        dateTime={event.startedAt}
        sx={{
          pt: 1.75,
          fontFamily: (theme) => theme.typography.h5.fontFamily,
          fontSize: '1rem',
          fontVariantNumeric: 'lining-nums tabular-nums',
        }}
      >
        {time}
      </Typography>
      <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', pt: 0.75 }}>
        {hasNext && <ConnectingLine />}
        <EventIllustration type={type} payload={event.payload} size={32} />
      </Box>
      <Box
        sx={(theme) => ({
          mb: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          borderRadius: `${RADIUS.tile}px`,
          backgroundColor: palette(theme).category[view.category].bg,
          // The coloured left edge follows the card's corners.
          boxShadow: `inset 4px 0 0 ${palette(theme).category[view.category].fg}`,
        })}
      >
        <ButtonBase
          onClick={() => onEdit(event)}
          disabled={readOnly}
          aria-label={
            readOnly ? `${view.title}, ${time}` : t('day.editRow', { title: view.title, time })
          }
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 56,
            display: 'block',
            textAlign: 'start',
            pl: 2,
            pr: 1.5,
            py: 1,
            borderRadius: `${RADIUS.tile}px`,
            '&.Mui-disabled': { opacity: 1 },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{view.title}</Typography>
            <SyncMark state={syncState} />
          </Box>
          {detail && (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {detail}
            </Typography>
          )}
        </ButtonBase>
        {(running || length) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5, flexShrink: 0 }}>
            {running ? (
              <RunningPill event={event} />
            ) : (
              <DurationPill text={length!} {...(pausedText ? { pausedText } : {})} />
            )}
            {running && onStop && (
              <ButtonBase
                onClick={() => onStop(event)}
                aria-label={t('day.stopNamed', { title: view.title })}
                sx={(theme) => ({
                  minWidth: 44,
                  minHeight: 44,
                  borderRadius: '50%',
                  boxShadow: `inset 0 0 0 1.5px ${palette(theme).primary.main}`,
                  color: palette(theme).primary.main,
                })}
              >
                <Icon name="stop" size={20} />
              </ButtonBase>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
