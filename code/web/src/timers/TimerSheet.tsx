import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Collapse,
  Drawer,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import type { BabyEvent, EventType } from '../db/models';
import { SleepDetails } from '../events/SleepDetails';
import { SLEEP_DETAIL_KEYS, type DetailValues } from '../events/sleepDetailModel';
import { formatElapsed, useNow } from '../events/time';
import { formatDuration, formatTime } from '../i18n/format';
import { useEventTypeText } from '../i18n/eventTypeText';
import { CONTENT_MAX_WIDTH, RADIUS } from '../theme/tokens';
import { NotesRow, TimePanel } from '../ui/form';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { EventIllustration } from '../ui/illustrations/EventIllustration';
import { getOwn } from '../util/ownProperty';
import { effectiveElapsedSeconds, isPaused, readPause } from './pauseMath';
import { timerKindOf } from './runningTimers';
import { PauseAnnouncer, PauseResumeButton, PausedClock } from './TimerParts';
import { useTimerTitle } from './useTimerTitle';
import { LockedNote } from '../baby/LockedNote';
import { BottleTimerTarget, TimerTarget } from './TimerTarget';
import type { TimerCommands } from './useTimerCommands';

interface Props {
  babyId: string;
  types: EventType[];
  /** The running timer (live: the owner passes the stored copy). */
  event: BabyEvent;
  readOnly: boolean;
  /**
   * Who started the timer when the user may not change it (a Caregiver and someone else's timer,
   * `EventAccess.lockedBy`): the menu, Discard and the details are off, and the sheet says why.
   */
  lockedBy?: string | null;
  /**
   * Who started it when the user may not even stop or pause it (`EventAccess.controlLockedBy`; a
   * Caregiver may stop, pause and resume someone else's timer, except a nursing session).
   */
  controlLockedBy?: string | null;
  onClose: () => void;
  /** Stops the timer (asking for missing required fields first); the sheet closes. */
  onStop: (event: BabyEvent, name: string) => void;
  /** Opens the full event sheet for the timer; this sheet closes. */
  onEditAll: (event: BabyEvent) => void;
  commands: TimerCommands;
  /** Runs a command and shows its error (the owner's snackbar). */
  run: (action: () => Promise<unknown>) => void;
}

/** The detail values the sleep section reads: the kind and the detail fields, as text. */
function detailValues(event: BabyEvent): DetailValues {
  const values: Record<string, string> = {};
  for (const key of ['kind', ...SLEEP_DETAIL_KEYS]) {
    const raw = getOwn(event.payload, key);
    if (typeof raw === 'string' || typeof raw === 'number') values[key] = String(raw);
  }
  return values;
}

function MenuEntry({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <MenuItem onClick={onClick} sx={{ minHeight: 48, gap: 1.5 }}>
      <ListItemIcon sx={{ minWidth: 0 }}>
        <Icon name={icon} />
      </ListItemIcon>
      {label}
    </MenuItem>
  );
}

/**
 * The timer sheet (docs/design/SYNTHESIS.md section 6): the event's illustration, its name, the
 * elapsed time in large serif numerals (pause-aware, live), the quiet target, Pause/Resume and
 * Stop, a trash icon that discards with Undo, and an overflow menu: adjust the start time, add a
 * note, switch nap/night or the nursing side, edit every detail. Sleep timers also get the
 * collapsed "Sleep details" section. The owner unmounts it when the timer stops or disappears.
 */
export function TimerSheet({
  babyId,
  types,
  event,
  readOnly: viewOnly,
  lockedBy = null,
  controlLockedBy = null,
  onClose,
  onStop,
  onEditAll,
  commands,
  run,
}: Props) {
  const readOnly = viewOnly || lockedBy !== null;
  const controlOff = viewOnly || controlLockedBy !== null;
  const { t } = useTranslation();
  const names = useEventTypeText();
  const title = useTimerTitle();
  const titleId = useId();
  const menuId = useId();
  const nowMs = useNow(1000);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<'start' | 'note' | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [mountedAt] = useState(() => new Date());
  const type = types.find((candidate) => candidate.id === event.typeId);
  const kind = timerKindOf(event, type);
  const name = title({ event, type, kind });
  const paused = isPaused(event);
  const pause = readPause(event.payload);
  const effective = effectiveElapsedSeconds(event, nowMs);
  const isSleep = kind === 'sleep';
  const closeMenu = () => setMenu(null);
  const choose = (action: () => void) => () => {
    closeMenu();
    action();
  };
  const typeName = type ? names.typeName(type) : t('common.event');
  const notes = noteDraft ?? event.notes ?? '';

  const commitNote = () => {
    if (noteDraft === null) return;
    const next = noteDraft.trim() || null;
    setNoteDraft(null);
    if (next !== event.notes) run(() => commands.setNotes(event.id, next));
  };

  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-labelledby': titleId,
          sx: {
            maxWidth: CONTENT_MAX_WIDTH,
            mx: 'auto',
            width: '100%',
            maxHeight: 'calc(100dvh - 16px)',
            borderTopLeftRadius: RADIUS.sheetTop,
            borderTopRightRadius: RADIUS.sheetTop,
          },
        },
      }}
    >
      <Box
        sx={{
          px: 2.5,
          pt: 1,
          pb: 'calc(20px + env(safe-area-inset-bottom))',
          display: 'grid',
          gap: 2,
          minWidth: 0,
        }}
      >
        <PauseAnnouncer paused={paused} name={name} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton onClick={onClose} aria-label={t('timers.sheet.close')} edge="start">
            <Icon name="close" />
          </IconButton>
          {!readOnly && (
            <IconButton
              onClick={(e) => setMenu(e.currentTarget)}
              aria-label={t('timers.sheet.more')}
              aria-haspopup="menu"
              aria-controls={menu ? menuId : undefined}
              edge="end"
            >
              <Icon name="more" />
            </IconButton>
          )}
          <Menu id={menuId} anchorEl={menu} open={menu !== null} onClose={closeMenu}>
            <MenuEntry
              icon="clock"
              label={t('timers.sheet.adjustStart')}
              onClick={choose(() => setPanel('start'))}
            />
            <MenuEntry
              icon="note"
              label={event.notes ? t('timers.sheet.editNote') : t('timers.sheet.addNote')}
              onClick={choose(() => setPanel('note'))}
            />
            {isSleep && (
              <MenuEntry
                icon={getOwn(event.payload, 'kind') === 'night' ? 'zzz' : 'moon'}
                label={
                  getOwn(event.payload, 'kind') === 'night'
                    ? t('timers.sheet.switchToNap')
                    : t('timers.sheet.switchToNight')
                }
                onClick={choose(() => run(() => commands.switchSleepKind(event.id)))}
              />
            )}
            {kind === 'nursing' && (
              <MenuEntry
                icon="exchange"
                label={t('timers.sheet.switchSide')}
                onClick={choose(() => run(() => commands.switchSide(event.id)))}
              />
            )}
            <MenuEntry
              icon="edit"
              label={t('timers.sheet.editAll')}
              onClick={choose(() => onEditAll(event))}
            />
          </Menu>
        </Box>

        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 0.5, textAlign: 'center' }}>
          <EventIllustration type={type} payload={event.payload} size={96} glow />
          <Typography
            id={titleId}
            variant="h4"
            component="h2"
            sx={{ fontFamily: (theme) => theme.typography.fontFamilyDisplay }}
          >
            {title({ event, type, kind })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('timers.sheet.started', { time: formatTime(event.startedAt) })}
            {type && kind !== 'nursing' && type.key !== 'sleep' ? ` · ${typeName}` : ''}
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 0.75 }}>
          <Typography
            component="time"
            aria-hidden
            data-testid="timer-sheet-elapsed"
            sx={(theme) => ({
              fontFamily: theme.typography.fontFamilyDisplay,
              fontSize: 'clamp(3rem, 17vw, 4.25rem)',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums lining-nums',
              color: paused ? palette(theme).text.secondary : palette(theme).text.primary,
            })}
          >
            {formatElapsed(effective * 1000)}
          </Typography>
          <Box component="span" sx={visuallyHidden}>
            {t('timers.announce.running', {
              name,
              duration: formatDuration(effective * 1000),
            })}
          </Box>
          {paused && <PausedClock event={event} nowMs={nowMs} />}
          {!paused && pause.count > 0 && (
            <Typography variant="caption" color="text.secondary">
              {t('timers.sheet.pauses', {
                count: pause.count,
                duration: formatDuration(pause.pausedSeconds * 1000),
              })}
            </Typography>
          )}
        </Box>

        {isSleep && (
          <Box sx={{ px: 1 }}>
            <TimerTarget babyId={babyId} event={event} nowMs={nowMs} />
          </Box>
        )}
        {type?.babyId === null && type.key === 'feeding' && (
          <Box sx={{ px: 1, '&:empty': { display: 'none' } }}>
            <BottleTimerTarget babyId={babyId} event={event} nowMs={nowMs} />
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <PauseResumeButton
            paused={paused}
            name={name}
            large
            disabled={controlOff}
            onPress={() =>
              run(() => (paused ? commands.resume(event.id) : commands.pause(event.id)))
            }
          />
          <Button
            variant="contained"
            disabled={controlOff}
            startIcon={<Icon name="stop" size={20} />}
            aria-label={t('timers.stopNamed', { name })}
            onClick={() => onStop(event, name)}
            sx={{ flex: 1.3, minHeight: 56, borderRadius: '999px' }}
          >
            {t('timers.stop')}
          </Button>
          <IconButton
            disabled={readOnly}
            aria-label={t('timers.sheet.discard')}
            onClick={() => {
              onClose();
              run(() => commands.discard(event, name));
            }}
            sx={(theme) => ({
              width: 48,
              height: 48,
              flexShrink: 0,
              color: palette(theme).error.main,
              boxShadow: `inset 0 0 0 1.5px ${palette(theme).hairline}`,
            })}
          >
            <Icon name="delete" />
          </IconButton>
        </Box>
        {controlLockedBy !== null ? (
          <LockedNote name={controlLockedBy} />
        ) : (
          lockedBy !== null && <LockedNote name={lockedBy} kind="control" />
        )}

        <Collapse in={panel === 'start'} unmountOnExit>
          <Box
            role="group"
            aria-label={t('timers.sheet.adjustTitle')}
            sx={{ display: 'grid', gap: 1 }}
          >
            <Typography variant="subtitle2">{t('timers.sheet.adjustTitle')}</Typography>
            <TimePanel
              compact
              value={new Date(event.startedAt)}
              now={mountedAt}
              max={new Date(Math.max(mountedAt.getTime(), nowMs))}
              onChange={(date) => {
                if (date) run(() => commands.adjustStart(event.id, date.toISOString()));
              }}
              aria-label={t('timers.sheet.adjustTitle')}
            />
            <Typography variant="caption" color="text.secondary">
              {t('timers.sheet.adjustHint')}
            </Typography>
            <Button onClick={() => setPanel(null)} sx={{ minHeight: 44, justifySelf: 'start' }}>
              {t('timers.sheet.adjustDone')}
            </Button>
          </Box>
        </Collapse>

        <Collapse in={panel === 'note'} unmountOnExit>
          <Box
            role="group"
            aria-label={t('timers.sheet.addNote')}
            onBlur={commitNote}
            sx={{ display: 'grid', gap: 1 }}
          >
            <NotesRow defaultOpened value={notes} onChange={setNoteDraft} />
            <Button
              onClick={() => {
                commitNote();
                setPanel(null);
              }}
              sx={{ minHeight: 44, justifySelf: 'start' }}
            >
              {t('timers.sheet.noteDone')}
            </Button>
          </Box>
        </Collapse>

        {isSleep && (
          <SleepDetails
            type={type}
            values={detailValues(event)}
            disabled={readOnly}
            onChange={(key, value) =>
              run(() =>
                commands.setPayloadValue(
                  event.id,
                  key,
                  value === ''
                    ? null
                    : key === 'time_to_fall_asleep_minutes'
                      ? Number(value)
                      : value,
                ),
              )
            }
          />
        )}
      </Box>
    </Drawer>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
