import type { BabyRoutineDb } from '../db/database';
import {
  createEvent,
  pauseTimer,
  resumeTimer,
  stopEvent,
  type CommandOptions,
} from '../db/eventCommands';
import { eventTypesFor, runningEvents } from '../db/queries';
import { payloadString, typeForKey } from '../now/eventFacts';
import { stopNursing } from '../now/nursing';
import { runTrayChoice, type TrayChoice } from '../now/quickLog';
import { runSleepAction } from '../now/sleepToggle';
import { WIDGET_ACTIVITY_KEYS } from './activities';
import type { WidgetBridge } from './widgetBridge';

/*
 * `widget-outbox.json` (docs/design/37-widgets-siri.md 2.2): events asked for by voice or from the widget while the
 * app was closed. Each entry becomes a normal local event through the same write path as the UI and is then removed.
 */

export type OutboxType =
  | 'feed'
  | 'diaper'
  | 'sleep_start'
  | 'sleep_end'
  | 'activity'
  | 'feed_pause'
  | 'feed_resume'
  | 'feed_stop';

export interface OutboxEntry {
  id: string;
  babyId: string;
  type: OutboxType;
  occurredAt: string;
  payload: { kind?: string | null; amountMl?: number | null; side?: string | null };
  source: string;
}

const TYPES: readonly string[] = [
  'feed',
  'diaper',
  'sleep_start',
  'sleep_end',
  'activity',
  'feed_pause',
  'feed_resume',
  'feed_stop',
];
const DIAPER_CONTENTS: readonly string[] = ['WET', 'DIRTY', 'MIXED'];
const DRAINED_KEY = 'baby-routine.widget-drained';
const DRAINED_KEPT = 200;

/** Entries of the file that have the shape the app understands; anything else is dropped. */
export function parseOutbox(text: string): OutboxEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is OutboxEntry => {
      if (typeof e !== 'object' || e === null) return false;
      const o = e as Record<string, unknown>;
      return (
        typeof o.id === 'string' &&
        typeof o.babyId === 'string' &&
        typeof o.type === 'string' &&
        TYPES.includes(o.type) &&
        typeof o.occurredAt === 'string' &&
        !Number.isNaN(Date.parse(o.occurredAt))
      );
    })
    .map((e) => ({ ...e, payload: e.payload ?? {} }));
}

function readDrained(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DRAINED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function rememberDrained(id: string): void {
  try {
    const next = [...readDrained(), id].slice(-DRAINED_KEPT);
    window.localStorage.setItem(DRAINED_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: a crash between the write and the removal can then log the entry twice.
  }
}

function trayChoice(entry: OutboxEntry): TrayChoice | null {
  if (entry.type === 'feed') {
    const amount = entry.payload.amountMl;
    if (entry.payload.kind === 'bottle' && typeof amount === 'number' && amount > 0) {
      return { kind: 'bottle', amountMl: amount };
    }
    const side = entry.payload.side;
    return side === 'left' || side === 'right' ? { kind: 'breast', side } : { kind: 'breast' };
  }
  if (entry.type === 'diaper') {
    const content = (entry.payload.kind ?? 'wet').toUpperCase();
    return DIAPER_CONTENTS.includes(content) ? { kind: 'diaper', content } : null;
  }
  return null;
}

/**
 * A button of the activity widget: an instant event, or a running one when the type has a duration (stop it in the
 * app). An unknown key, or a type this baby does not have, is dropped.
 */
async function applyActivity(
  db: BabyRoutineDb,
  entry: OutboxEntry,
  types: Awaited<ReturnType<typeof eventTypesFor>>,
  options: CommandOptions,
): Promise<boolean> {
  const key = entry.payload.kind ?? '';
  if (!WIDGET_ACTIVITY_KEYS.includes(key)) return false;
  const type = typeForKey(types, key);
  if (!type) return false;
  await createEvent(
    db,
    {
      babyId: entry.babyId,
      typeId: type.id,
      startedAt: entry.occurredAt,
      endedAt: type.hasDuration ? null : entry.occurredAt,
    },
    options,
  );
  return true;
}

/** Pause, resume or stop of the bottle or breastfeed running now (the widget's play/pause). Nothing running: dropped. */
async function applyFeedTimer(
  db: BabyRoutineDb,
  entry: OutboxEntry,
  types: Awaited<ReturnType<typeof eventTypesFor>>,
  options: CommandOptions,
): Promise<boolean> {
  const feedTypeId = typeForKey(types, 'feeding')?.id;
  const running = (await runningEvents(db, entry.babyId)).find(
    (e) => e.typeId === feedTypeId && e.deletedAt === null && e.endedAt === null,
  );
  if (!running) return false;
  const isBreast = payloadString(running, 'method') === 'breast';
  if (entry.type === 'feed_stop') {
    if (isBreast) await stopNursing(db, running.id, options);
    else await stopEvent(db, running.id, undefined, options);
    return true;
  }
  if (isBreast) return false;
  if (entry.type === 'feed_pause') await pauseTimer(db, running.id, options);
  else await resumeTimer(db, running.id, options);
  return true;
}

/** Writes one entry as a local event. Returns false when the entry makes no sense (it is dropped). */
async function apply(db: BabyRoutineDb, entry: OutboxEntry): Promise<boolean> {
  if (!(await db.babies.get(entry.babyId))) return false;
  const types = await eventTypesFor(db, entry.babyId);
  const options = { now: () => new Date(entry.occurredAt), newId: () => entry.id };
  if (entry.type === 'sleep_start') {
    await runSleepAction(db, 'fell_asleep', { babyId: entry.babyId, types, options });
    return true;
  }
  if (entry.type === 'sleep_end') {
    await runSleepAction(db, 'woke_up', { babyId: entry.babyId, types, options });
    return true;
  }
  if (entry.type === 'activity') return applyActivity(db, entry, types, options);
  if (entry.type.startsWith('feed_')) return applyFeedTimer(db, entry, types, options);
  const choice = trayChoice(entry);
  if (!choice) return false;
  await runTrayChoice(db, choice, { babyId: entry.babyId, types, options });
  return true;
}

/**
 * Applies every pending entry, oldest first, then removes them from the file. An entry already applied (the app was
 * killed between the write and the removal) is only removed. An entry that fails stays for the next drain, unless it
 * can never work (unknown baby, bad content), which is dropped. Returns how many events were written.
 */
export async function drainOutbox(db: BabyRoutineDb, bridge: WidgetBridge): Promise<number> {
  return (await drainOutboxDetailed(db, bridge)).written;
}

/** What a drain did: events written, and entries taken out of the file (written, already applied or dropped). */
export interface DrainResult {
  written: number;
  removed: number;
}

/**
 * `drainOutbox`, also saying how many entries left the file. Any removed entry means a widget button or intent touched
 * the snapshot file since the app last wrote it (it applies its tap there at once), so the app must write it again even
 * when its own copy did not change (a dropped entry would otherwise stay on the widget).
 */
export async function drainOutboxDetailed(
  db: BabyRoutineDb,
  bridge: WidgetBridge,
): Promise<DrainResult> {
  const entries = parseOutbox(await bridge.readOutbox()).sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  );
  if (entries.length === 0) return { written: 0, removed: 0 };
  const drained = new Set(readDrained());
  const finished: string[] = [];
  let written = 0;
  for (const entry of entries) {
    if (drained.has(entry.id)) {
      finished.push(entry.id);
      continue;
    }
    try {
      if (await apply(db, entry)) written += 1;
      rememberDrained(entry.id);
      finished.push(entry.id);
    } catch {
      // Left in the file: the next resume tries again.
    }
  }
  if (finished.length > 0) await bridge.removeOutbox(finished);
  return { written, removed: finished.length };
}
