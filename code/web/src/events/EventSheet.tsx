import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  Drawer,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useEventTypeText } from '../i18n/eventTypeText';
import { formatDate, formatTime } from '../i18n/format';
import { FormulaField } from '../formulas/FormulaField';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { Field, MedicationPicker, NotesRow } from '../ui/form';
import { daysBeforeToday } from '../ui/form/timeMath';
import { getOwn } from '../util/ownProperty';
import { currentStartLevel } from './bottleSegments';
import { FUSSY_KEY } from '../now/fussyPattern';
import { AssistantOriginNote } from './AssistantOriginNote';
import { ConditionalFields } from './ConditionalFields';
import { CryAnswerRow } from './CryAnswerRow';
import { announceEventDeleted } from './deletedEvents';
import type { EventSheetProps } from './eventSheetTypes';
import { isMedicationType } from './formModel';
import { readLastUsed } from './lastUsedValues';
import { fromLocalInput } from './time';
import { SheetHeader } from './SheetHeader';
import { SleepDetails } from './SleepDetails';
import { SLEEP_DETAIL_SET } from './sleepDetailModel';
import { useBottleSuggestions } from './useBottleHistory';
import { useEventSheetForm } from './useEventSheetForm';
import { WhenFields } from './WhenFields';

export type { EventSheetProps, FinishMode } from './eventSheetTypes';

const FOCUSABLE = 'input, textarea, [role="radio"][tabindex="0"], button:not(:disabled)';

/** Moves focus to the control of the field with the given key. */
function focusField(root: HTMLElement | null, key: string | undefined) {
  if (!root || key === undefined) return;
  const holder = Array.from(root.querySelectorAll<HTMLElement>('[data-field-key]')).find(
    (el) => el.dataset.fieldKey === key,
  );
  // A text field wins over the buttons before it (the quick time chips come before the time).
  (
    holder?.querySelector<HTMLElement>('input, textarea') ??
    holder?.querySelector<HTMLElement>(FOCUSABLE)
  )?.focus();
}

function SwitchBanner({
  name,
  cleared,
  onUndo,
}: {
  name: string;
  cleared: boolean;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.75,
        pl: 1.5,
        pr: 0.5,
        borderRadius: `${RADIUS.input}px`,
        backgroundColor: (theme.vars ?? theme).palette.surfaceRaised,
        fontSize: '0.875rem',
      })}
    >
      <Icon name="info" size={20} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {t(cleared ? 'events.sheet.typeChangedCleared' : 'events.sheet.typeChanged', { name })}
      </Box>
      <Button onClick={onUndo} sx={{ minHeight: 44, flexShrink: 0 }}>
        {t('presets.undo.action')}
      </Button>
    </Box>
  );
}

const PILL_BUTTON = { flex: '1 1 140px', minHeight: 48, borderRadius: '999px' } as const;

function DiscardBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const { t } = useTranslation();
  return (
    <Box
      role="group"
      aria-label={t('events.sheet.discardQuestion')}
      sx={{ display: 'grid', gap: 1.5 }}
    >
      <Typography sx={{ fontWeight: 600 }}>{t('events.sheet.discardQuestion')}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={onKeep} autoFocus sx={PILL_BUTTON}>
          {t('events.sheet.keepEditing')}
        </Button>
        <Button color="error" variant="outlined" onClick={onDiscard} sx={PILL_BUTTON}>
          {t('events.sheet.discard')}
        </Button>
      </Box>
    </Box>
  );
}

/** The surface shared by the drawer (phones) and the dialog (md and up). */
function Frame({
  desktop,
  titleId,
  onClose,
  children,
}: {
  desktop: boolean;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (desktop) {
    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        aria-labelledby={titleId}
        slotProps={{
          paper: {
            sx: {
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 'min(760px, calc(100dvh - 64px))',
            },
          },
        }}
      >
        {children}
      </Dialog>
    );
  }
  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-labelledby': titleId,
          sx: {
            display: 'flex',
            flexDirection: 'column',
            // Short for a quick log; long forms scroll inside, the Save footer stays in view.
            height: 'auto',
            maxHeight: 'calc(100dvh - 16px)',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          },
        },
      }}
    >
      {children}
    </Drawer>
  );
}

const minuteOf = (d: Date) => Math.floor(d.getTime() / 60_000);

/** "Today", "Yesterday" or the date, for the large time of the header. */
function heroDayLabel(date: Date, now: Date, t: TFunction): string {
  const days = daysBeforeToday(date, now);
  if (days === 0) return t('ui.time.today');
  if (days === 1) return t('ui.time.yesterday');
  return formatDate(date, 'weekdayDayMonth');
}

/**
 * The add/edit event sheet (docs/design/SYNTHESIS.md wave 4): a full-height bottom sheet on phones,
 * a dialog from `md` up, with a sticky Save footer. Header: category icon, type name (tap to
 * change the type, with Undo), close and, when editing, the overflow menu with Delete (undo
 * instead of a confirmation). Then When (inline time panel), the type's fields with `visibleWhen`,
 * medications and a note. Problems show under their field and focus moves to the first one.
 * `finish` is the compact "Finish this ..." form. Mount it only while open.
 */
export function EventSheet(props: EventSheetProps) {
  const { babyId, types, event, finish, onDone } = props;
  const { t } = useTranslation();
  const names = useEventTypeText();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const state = useEventSheetForm(props);
  const [discarding, setDiscarding] = useState(false);
  const { form, type, problems, focusTick } = state;

  useEffect(() => {
    if (focusTick > 0) focusField(bodyRef.current, problems[0]?.field);
    // Only a new failed save moves focus, not every edit of the problems.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  const requestClose = () => {
    if (state.saving) return;
    if (state.dirty) setDiscarding(true);
    else onDone();
  };

  const remove = async () => {
    const removed = await state.remove();
    if (!removed) return;
    const { deleted, wakeUp } = removed;
    announceEventDeleted(deleted, type ? names.typeName(type) : t('common.event'), wakeUp);
    onDone();
  };

  const typeName = type ? names.typeName(type) : t('common.event');
  const finishing = !!(event && finish);
  const title = finishing
    ? t('events.finishTitle', { name: typeName.toLocaleLowerCase() })
    : undefined;
  const subtitle = (() => {
    if (finishing && event) {
      return t('events.sheet.startedAt', { time: formatTime(event.startedAt) });
    }
    if (event) return t('events.sheet.loggedAt', { time: formatTime(event.startedAt) });
    const start = new Date(form.startedAt);
    return Number.isNaN(start.getTime()) || minuteOf(start) === minuteOf(state.openedAt)
      ? t('events.sheet.startingNow')
      : t('events.sheet.startingAt', { time: formatTime(start) });
  })();

  const editTime = () => focusField(bodyRef.current, 'start');
  const startDate = fromLocalInput(form.startedAt);
  const startedAt = startDate ? new Date(startDate) : null;
  const heroTime =
    !finishing && startedAt
      ? {
          clock: formatTime(startedAt),
          day: heroDayLabel(startedAt, state.openedAt, t),
        }
      : undefined;
  const remembered = type ? readLastUsed(babyId, type.id) : {};
  const rememberedMl = getOwn(remembered, 'amount_ml');
  const bottle = useBottleSuggestions(
    babyId,
    type,
    typeof rememberedMl === 'number' ? rememberedMl : null,
  );
  const saveLabel =
    finishing && event?.endedAt === null ? t('events.saveAndStop') : t('common.save');
  const note =
    problems.length > 0
      ? t('events.sheet.problems', { count: problems.length, first: problems[0].message })
      : state.saveError;

  return (
    <Frame desktop={desktop} titleId={titleId} onClose={requestClose}>
      <SheetHeader
        titleId={titleId}
        type={type}
        payload={form.values}
        title={title}
        subtitle={subtitle}
        {...(heroTime ? { time: heroTime, onEditTime: editTime } : {})}
        {...(finishing ? {} : { types, onChangeType: state.changeType })}
        onClose={requestClose}
        {...(event && !finishing ? { onDelete: () => void remove() } : {})}
      />
      <Box
        ref={bodyRef}
        sx={{
          flex: '1 1 auto',
          overflowY: 'auto',
          px: 2.5,
          pb: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          // Collapsing fields (overflow hidden) must not be squeezed to nothing by the sheet height.
          '& > *': { flexShrink: 0 },
        }}
      >
        <ErrorBoundary>
          {state.switched && (
            <SwitchBanner
              name={state.switched.name}
              cleared={state.switched.cleared}
              onUndo={state.undoSwitch}
            />
          )}
          {!finishing && (
            <WhenFields
              type={type}
              form={form}
              now={state.openedAt}
              errors={state.errors}
              onChange={state.edit}
              instant={state.instant}
            />
          )}
          {!finishing && state.cryQuestion && type?.key === FUSSY_KEY && (
            <CryAnswerRow
              answer={state.crying}
              onAnswer={(crying) => void state.answerCry(crying)}
            />
          )}
          {type && isMedicationType(type) && (
            <Box data-field-key="medications">
              <Field label={t('events.medications')} group error={state.errors.medications}>
                <MedicationPicker
                  babyId={babyId}
                  selected={form.medications}
                  onChange={(medications) => state.edit({ medications })}
                />
              </Field>
            </Box>
          )}
          {type && !isMedicationType(type) && (
            <ConditionalFields
              type={type}
              values={form.values}
              only={finish?.fields}
              {...(finishing && event && event.endedAt === null
                ? { leftCeiling: currentStartLevel(event.payload) }
                : {})}
              {...(!finishing && type.key === 'sleep' && type.babyId === null
                ? { exclude: SLEEP_DETAIL_SET }
                : {})}
              errors={state.errors}
              remembered={remembered}
              {...(bottle ? { bottle } : {})}
              onChange={state.setValue}
            />
          )}
          <FormulaField babyId={babyId} choice={state.formula} />
          {type && !finishing && (
            <SleepDetails type={type} values={form.values} onChange={state.setValue} />
          )}
          {event && !finishing && <AssistantOriginNote event={event} />}
          {!finishing && (
            <Box data-field-key="notes">
              <NotesRow value={form.notes} onChange={(notes) => state.edit({ notes })} />
            </Box>
          )}
        </ErrorBoundary>
      </Box>
      <Box
        sx={{
          flex: '0 0 auto',
          borderTop: 1,
          borderColor: 'divider',
          px: 2.5,
          pt: 1.5,
          pb: 'calc(16px + env(safe-area-inset-bottom))',
        }}
      >
        {discarding ? (
          <DiscardBar onKeep={() => setDiscarding(false)} onDiscard={onDone} />
        ) : (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Box role="status" sx={{ color: 'error.main', fontSize: '0.875rem' }}>
              {note}
            </Box>
            <Button
              variant="contained"
              fullWidth
              onClick={() => void state.submit()}
              aria-busy={state.saving || undefined}
              startIcon={
                state.saving ? (
                  <CircularProgress size={20} color="inherit" aria-hidden />
                ) : undefined
              }
              sx={{ minHeight: 56, borderRadius: '999px', fontSize: '1rem' }}
            >
              {saveLabel}
            </Button>
          </Box>
        )}
      </Box>
    </Frame>
  );
}
