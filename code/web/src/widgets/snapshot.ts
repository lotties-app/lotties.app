import { readCachedAgeNorms } from '../ageNorms/ageNormsCache';
import type { BabyRoutineDb } from '../db/database';
import { currentLocale } from '../i18n/i18n';
import { allBabies, eventsStartedSince, eventTypesFor, runningEvents } from '../db/queries';
import type { BabyEvent, EventType } from '../db/models';
import type { AgeNormSet } from '../ageNorms/ageNorms';
import type { PredictionsDto } from '../sync/contract';
import { DAY_MS, payloadNumber, payloadString, typeForKey } from '../now/eventFacts';
import { deriveNowState } from '../now/nowState';
import { upcomingToday } from '../now/upcoming';
import { readCachedPredictions } from '../predictions/predictionsCache';

/*
 * `widget-snapshot.json` (docs/design/37-widgets-siri.md 2.1): what the widget shows, facts only.
 * Times are absolute UTC ISO strings; the widget renders "x min ago" itself.
 */

export interface SnapshotBaby {
  id: string;
  name: string;
  sleep?: { state: 'asleep' | 'awake'; startedAt: string };
  lastFeed?: { at: string; kind: string; amountMl?: number; side?: string };
  lastDiaper?: { at: string; kind: string };
  /** The estimates the Now screen shows ("next up"), from the last predictions the app fetched; estimates only. */
  nextNap?: { earliest: string; expected: string; latest: string };
  nextFeed?: { at: string; amountMl?: number };
  nextDiaper?: { at: string; kind: 'wet' | 'dirty' };
}

export interface WidgetSnapshotDto {
  version: 1;
  updatedAt: string;
  signedIn: true;
  selectedBabyId: string | null;
  /** The lock screen is visible to others: the widget leaves names out there unless this is false. */
  hideNamesOnLockScreen: boolean;
  /** The language of the app (not of the phone): the widget, the Siri intents and their spoken answers follow it. */
  language: 'pt-BR' | 'en';
  babies: SnapshotBaby[];
}

/** How far back "last feed" and "last diaper" look; older ones show as "no record". */
const LOOKBACK_MS = 3 * DAY_MS;

function newestOf(
  events: readonly BabyEvent[],
  typeId: string | undefined,
  now: Date,
): BabyEvent | undefined {
  if (!typeId) return undefined;
  const nowIso = now.toISOString();
  return events
    .filter((e) => e.typeId === typeId && e.startedAt <= nowIso)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

async function snapshotBaby(
  db: BabyRoutineDb,
  baby: { id: string; name: string; birthDate?: string | null },
  ageNorms: AgeNormSet | null,
  now: Date,
): Promise<SnapshotBaby> {
  const types = await eventTypesFor(db, baby.id);
  const from = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const recent = await eventsStartedSince(db, baby.id, from);
  const running = await runningEvents(db, baby.id);
  const events = [...new Map([...recent, ...running].map((e) => [e.id, e])).values()];

  const result: SnapshotBaby = { id: baby.id, name: baby.name };

  const predictions = readCachedPredictions(baby.id)?.data;
  const state = deriveNowState(events, types, predictions, now);
  if (state.kind === 'asleep') result.sleep = { state: 'asleep', startedAt: state.since };
  else if (state.kind === 'awake') result.sleep = { state: 'awake', startedAt: state.since };

  const feed = newestOf(events, typeForKey(types, 'feeding')?.id, now);
  if (feed) {
    const amountMl = payloadNumber(feed, 'amount_ml');
    const side = payloadString(feed, 'side');
    result.lastFeed = {
      at: feed.startedAt,
      kind: payloadString(feed, 'method') ?? 'other',
      ...(amountMl !== undefined ? { amountMl } : {}),
      ...(side ? { side } : {}),
    };
  }
  const diaper = newestOf(events, typeForKey(types, 'diaper')?.id, now);
  if (diaper) {
    result.lastDiaper = {
      at: diaper.startedAt,
      kind: (payloadString(diaper, 'content') ?? 'other').toLowerCase(),
    };
  }
  addNextUp(result, baby, state, events, types, predictions, ageNorms, now);
  return result;
}

/** The nap window while awake, and the next feed and diaper (the Now screen's "next up" estimates). */
function addNextUp(
  result: SnapshotBaby,
  baby: { birthDate?: string | null },
  state: ReturnType<typeof deriveNowState>,
  events: readonly BabyEvent[],
  types: readonly EventType[],
  predictions: PredictionsDto | undefined,
  ageNorms: AgeNormSet | null,
  now: Date,
): void {
  if (state.kind === 'awake' && state.window && state.window.latest > now.toISOString()) {
    const { earliest, expected, latest } = state.window;
    result.nextNap = { earliest, expected, latest };
  }
  const items = upcomingToday({
    events,
    types,
    now,
    birthDate: baby.birthDate ?? null,
    predictions: predictions ?? null,
    ageNorms,
  });
  const feed = items.find((item) => item.kind === 'feed');
  if (feed) {
    const ml = feed.amountMl?.typical;
    result.nextFeed = { at: feed.at.toISOString(), ...(ml ? { amountMl: Math.round(ml) } : {}) };
  }
  const diaper = items
    .filter((item) => item.kind === 'diaperWet' || item.kind === 'diaperDirty')
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (diaper) {
    result.nextDiaper = {
      at: diaper.at.toISOString(),
      kind: diaper.kind === 'diaperDirty' ? 'dirty' : 'wet',
    };
  }
}

/**
 * One baby at a time, one query at a time: WebKit's IndexedDB throws "Attempt to iterate a cursor that doesn't
 * exist" when several cursors run side by side (seen on the iPhone with a Promise.all over the babies).
 */
async function inSequence<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const item of items) results.push(await run(item));
  return results;
}

export async function buildSnapshot(
  db: BabyRoutineDb,
  selectedBabyId: string | null,
  now: Date = new Date(),
): Promise<WidgetSnapshotDto> {
  const babies = await allBabies(db);
  const ageNorms = (await readCachedAgeNorms(db))?.norms ?? null;
  return {
    version: 1,
    updatedAt: now.toISOString(),
    signedIn: true,
    selectedBabyId,
    hideNamesOnLockScreen: true,
    language: currentLocale() === 'pt-BR' ? 'pt-BR' : 'en',
    babies: await inSequence(babies, (b) => snapshotBaby(db, b, ageNorms, now)),
  };
}
