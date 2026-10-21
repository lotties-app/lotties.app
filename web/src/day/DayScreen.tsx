import { useMemo, useRef, useState, type TouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Skeleton, Typography } from '@mui/material';
import { canWrite } from '../baby/permissions';
import { useEntitySyncStates, useEventsInRange, useEventTypes, useMedications } from '../db/hooks';
import type { Baby, BabyEvent, EventType } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import type { FormPrefill } from '../events/formModel';
import { useNow } from '../events/time';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { typeForKey } from '../now/eventFacts';
import { MoreSheet } from '../now/ui/MoreSheet';
import type { TrayName } from '../now/ui/trays';
import { usePresetActions } from '../presets/usePresetActions';
import { RADIUS, type CategoryName } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { DateBar } from './DateBar';
import { DayFilterSheet } from './DayFilterSheet';
import { DayRow } from './DayRow';
import { DaySummary } from './DaySummary';
import {
  addDays,
  categoriesOf,
  dayBounds,
  eventsOfDay,
  filterByCategory,
  isSameDay,
  queryRange,
  startOfDay,
  summarizeDay,
} from './dayModel';
import { useDayLabel } from './useDayLabel';

/** Horizontal travel (px) that counts as a swipe, and how much more horizontal than vertical. */
const SWIPE_DISTANCE = 64;
const SWIPE_RATIO = 1.5;

/** The built-in type each Now tray stands for; the Day screen opens the full sheet instead. */
const TRAY_TYPE_KEY: Readonly<Record<TrayName, string>> = {
  feed: 'feeding',
  diaper: 'diaper',
  meds: 'medication',
  bellyPain: 'belly_pain',
  more: '',
};

function DaySkeleton() {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      sx={{ display: 'grid', gap: 1.5 }}
    >
      <Skeleton variant="rounded" height={44} />
      <Skeleton variant="rounded" height={72} />
      {[0, 1, 2, 3].map((index) => (
        <Skeleton
          key={index}
          variant="rounded"
          height={64}
          sx={{ borderRadius: `${RADIUS.tile}px` }}
        />
      ))}
    </Box>
  );
}

function EmptyDay({ readOnly, onAdd }: { readOnly: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 5, textAlign: 'center' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }} aria-hidden>
        <CategoryIcon name="bottle" category="feeding" size={20} />
        <CategoryIcon name="moon" category="sleep" size={32} />
        <CategoryIcon name="diaper" category="diaper" size={20} />
      </Box>
      <Typography variant="h6" component="h2">
        {t('day.empty.title')}
      </Typography>
      {!readOnly && (
        <Button
          variant="contained"
          onClick={onAdd}
          startIcon={<Icon name="add" size={20} />}
          sx={{ minHeight: 48, borderRadius: '999px', px: 3 }}
        >
          {t('day.addEvent')}
        </Button>
      )}
    </Box>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1, py: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{t('day.noMatches')}</Typography>
      <Button onClick={onClear} sx={{ minHeight: 44 }}>
        {t('day.clear')}
      </Button>
    </Box>
  );
}

/** Noon of `day` as a new-event prefill (adding to a past day must not land on today). */
function prefillFor(typeId: string, day: Date): FormPrefill {
  return {
    typeId,
    startedAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString(),
    endedAt: null,
    payload: {},
  };
}

/**
 * The Day tab (docs/DESIGN.md section 11): date bar with swipe, a summary strip and 24-hour ribbon,
 * a category filter, and the day's events as rows (newest first). Tap a row to edit it, Stop a
 * running one in place. The data is a live query for the local day (by the `[babyId+startedAt]`
 * index), so a busy history stays fast. `initialDay` opens another day (the dev preview).
 */
export function DayScreen({ baby, initialDay }: { baby: Baby; initialDay?: Date }) {
  const { t } = useTranslation();
  const clock = useNow(60_000);
  const today = useMemo(() => startOfDay(new Date(clock)), [clock]);
  const [picked, setPicked] = useState<Date | null>(initialDay ?? null);
  const day = picked ?? today;
  const bounds = useMemo(() => dayBounds(day), [day]);
  const range = useMemo(() => queryRange(bounds), [bounds]);
  const [selected, setSelected] = useState<ReadonlySet<CategoryName>>(() => new Set());
  const [filtering, setFiltering] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BabyEvent | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const types = useEventTypes(baby.id);
  const medications = useMedications(baby.id);
  const events = useEventsInRange(baby.id, range.from, range.to);
  const syncStates = useEntitySyncStates(baby.id);
  const actions = usePresetActions(baby.id, types ?? []);
  const label = useDayLabel(day, today);
  const writable = canWrite(baby);

  const go = (next: Date) => setPicked(isSameDay(next, today) ? null : next);
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = swipe.current;
    const touch = event.changedTouches[0];
    swipe.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
    // Swiping left reveals the next (later) day, right the previous one.
    if (dx < 0) {
      if (!isSameDay(day, today)) go(addDays(day, 1));
    } else go(addDays(day, -1));
  };

  if (!types || !medications || !events) return <DaySkeleton />;

  const summary = summarizeDay(events, types, bounds, new Date(clock));
  const dayEvents = eventsOfDay(events, bounds);
  const rows = filterByCategory(dayEvents, types, selected);
  const typeOf = (event: BabyEvent): EventType | undefined =>
    types.find((candidate) => candidate.id === event.typeId);

  const openTray = (tray: TrayName) => {
    const key = TRAY_TYPE_KEY[tray];
    const type = key ? typeForKey(types, key) : undefined;
    if (type) setCreating(type.id);
  };
  const addEvent = () => {
    if (isSameDay(day, today)) setAdding(true);
    else if (types[0]) setCreating(types[0].id);
  };
  const creatingPrefill =
    creating && !isSameDay(day, today) ? prefillFor(creating, day) : undefined;

  return (
    <Box
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      sx={{
        display: 'grid',
        gap: 2,
        touchAction: 'pan-y',
        minHeight: '60dvh',
        alignContent: 'start',
      }}
    >
      <Typography component="h1" sx={visuallyHidden}>
        {t('day.title')}
      </Typography>
      <DateBar
        day={day}
        today={today}
        onChange={go}
        filterCount={selected.size}
        onOpenFilter={() => setFiltering(true)}
      />
      <DaySummary summary={summary} />
      {dayEvents.length === 0 && <EmptyDay readOnly={!writable} onAdd={addEvent} />}
      {dayEvents.length > 0 && rows.length === 0 && (
        <NoMatches onClear={() => setSelected(new Set())} />
      )}
      {rows.length > 0 && (
        <Box component="ul" aria-label={label} sx={{ m: 0, p: 0 }}>
          {rows.map((event, index) => (
            <ErrorBoundary key={event.id}>
              <DayRow
                event={event}
                type={typeOf(event)}
                medications={medications}
                syncState={syncStates?.get(event.id)}
                hasNext={index < rows.length - 1}
                onEdit={setEditing}
                {...(writable
                  ? {
                      onStop: (running: BabyEvent) =>
                        void actions.stop(running, { name: typeOf(running)?.name }),
                    }
                  : {})}
                readOnly={!writable}
              />
            </ErrorBoundary>
          ))}
        </Box>
      )}
      <DayFilterSheet
        open={filtering}
        onClose={() => setFiltering(false)}
        categories={categoriesOf(types)}
        selected={selected}
        onChange={setSelected}
      />
      {adding && (
        <MoreSheet
          open
          onClose={() => setAdding(false)}
          types={types}
          events={dayEvents}
          actions={actions}
          readOnly={!writable}
          onOpenTray={openTray}
          onStartNursing={() => openTray('feed')}
        />
      )}
      {editing && (
        <EventSheet
          babyId={baby.id}
          types={types}
          event={editing}
          onDone={() => setEditing(null)}
        />
      )}
      {creating && (
        <EventSheet
          babyId={baby.id}
          types={types}
          initialTypeId={creating}
          {...(creatingPrefill ? { prefill: creatingPrefill } : {})}
          onDone={() => setCreating(null)}
        />
      )}
      {writable && actions.elements}
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
