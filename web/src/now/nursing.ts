import type { BabyRoutineDb } from '../db/database';
import { createEvent, editEvent, finishEvent, type CommandOptions } from '../db/eventCommands';
import { EventAlreadyStoppedError, EventDeletedError, EventNotFoundError } from '../db/errors';
import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { eventsStartedSince, runningEvents } from '../db/queries';
import {
  PresetAlreadyRunningError,
  PresetNotRunnableError,
  type UndoToken,
} from '../presets/actions';
import { setOwn, withoutOwn } from '../util/ownProperty';
import { DAY_MS, payloadNumber, payloadString, typeForKey } from './eventFacts';

/*
 * Nursing sessions with live left/right timers (docs/design/01-ux-strategy.md flow 1, 03 section 3).
 * Everything lives in the event payload, so the seconds survive reloads and sync to other devices:
 * - `side`: the side in use while running; on stop, which sides were used (left/right/both);
 * - `breast_left_seconds` / `breast_right_seconds`: seconds of the closed segments;
 * - `side_since` (undeclared, the API keeps undeclared keys): start of the open segment;
 * - `last_side` (undeclared, set on stop): the side the feed ended on (next feed starts opposite).
 */

export type BreastSide = 'left' | 'right';

export const SIDE_SINCE_KEY = 'side_since';
export const LAST_SIDE_KEY = 'last_side';
const SECONDS_KEY: Record<BreastSide, string> = {
  left: 'breast_left_seconds',
  right: 'breast_right_seconds',
};

export const otherSide = (side: BreastSide): BreastSide => (side === 'left' ? 'right' : 'left');

export const parseBreastSide = (value: string | undefined): BreastSide | undefined =>
  value === 'left' || value === 'right' ? value : undefined;

export function isNursingEvent(event: BabyEvent, feedingTypeId: string | undefined): boolean {
  return (
    event.deletedAt === null &&
    event.typeId === feedingTypeId &&
    payloadString(event, 'method') === 'breast'
  );
}

/** The side of the open segment (a running session without a valid side counts as left). */
export function currentSide(event: Pick<BabyEvent, 'payload'>): BreastSide {
  return parseBreastSide(payloadString(event, 'side')) ?? 'left';
}

const closedSeconds = (event: Pick<BabyEvent, 'payload'>, side: BreastSide) =>
  Math.max(0, Math.floor(payloadNumber(event, SECONDS_KEY[side]) ?? 0));

/**
 * Start of the open segment: `side_since`, else (payload edited by an older client) the start plus
 * the closed seconds, which is exact when the session never paused.
 */
function segmentStart(event: Pick<BabyEvent, 'payload' | 'startedAt'>): number {
  const since = Date.parse(payloadString(event, SIDE_SINCE_KEY) ?? '');
  if (Number.isFinite(since)) return since;
  const closed = closedSeconds(event, 'left') + closedSeconds(event, 'right');
  return Date.parse(event.startedAt) + closed * 1000;
}

export interface NursingElapsed {
  left: number;
  right: number;
  total: number;
  /** The running side; `null` once stopped. */
  side: BreastSide | null;
  /** Start of the open segment (UTC ISO); `null` once stopped. */
  sideSince: string | null;
}

/** Seconds per side at `now` (the open segment included), for the live L/R clocks. */
export function nursingElapsed(
  event: Pick<BabyEvent, 'payload' | 'startedAt' | 'endedAt'>,
  now: Date,
): NursingElapsed {
  const seconds = { left: closedSeconds(event, 'left'), right: closedSeconds(event, 'right') };
  if (event.endedAt !== null) {
    return { ...seconds, total: seconds.left + seconds.right, side: null, sideSince: null };
  }
  const side = currentSide(event);
  const start = segmentStart(event);
  seconds[side] += Math.max(0, Math.floor((now.getTime() - start) / 1000));
  return {
    ...seconds,
    total: seconds.left + seconds.right,
    side,
    sideSince: new Date(start).toISOString(),
  };
}

export interface StartSideSuggestion {
  /** Side to start on: opposite to where the last feed ended, else left. */
  side: BreastSide;
  lastSide: BreastSide | null;
  /** Start of the last finished breast feed. */
  lastAt: string | null;
}

/** "Start right · left last time": from the newest finished breast feed in `events`. */
export function suggestedStartSide(
  events: readonly BabyEvent[],
  feedingTypeId: string | undefined,
): StartSideSuggestion {
  const last = events
    .filter((e) => e.endedAt !== null && isNursingEvent(e, feedingTypeId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!last) return { side: 'left', lastSide: null, lastAt: null };
  const lastSide =
    parseBreastSide(payloadString(last, LAST_SIDE_KEY)) ??
    parseBreastSide(payloadString(last, 'side')) ??
    null;
  return { side: lastSide ? otherSide(lastSide) : 'left', lastSide, lastAt: last.startedAt };
}

/** The payload with the open segment (up to `at`) added to its side's seconds. */
function closeSegment(event: BabyEvent, at: Date): EventPayload {
  const elapsed = nursingElapsed(event, at);
  const payload: EventPayload = { ...event.payload };
  setOwn<unknown>(payload, SECONDS_KEY.left, elapsed.left);
  setOwn<unknown>(payload, SECONDS_KEY.right, elapsed.right);
  return payload;
}

export interface NursingContext {
  babyId: string;
  types: readonly EventType[];
  /** `options.now` is the tap moment. */
  options?: CommandOptions;
}

function feedingTypeId(types: readonly EventType[]): string {
  const type = typeForKey(types, 'feeding');
  if (!type) throw new PresetNotRunnableError('nursing');
  return type.id;
}

function tapMoment(options: CommandOptions = {}) {
  const when = options.now?.() ?? new Date();
  return { when, iso: when.toISOString(), options: { ...options, now: () => when } };
}

/**
 * Starts a nursing session on `side` (default: opposite to where the last feed ended). Throws
 * `PresetAlreadyRunningError` while one runs, `PresetNotRunnableError` without the feeding type.
 */
export async function startNursing(
  db: BabyRoutineDb,
  ctx: NursingContext & { side?: BreastSide },
): Promise<UndoToken> {
  const typeId = feedingTypeId(ctx.types);
  const { when, iso, options } = tapMoment(ctx.options);
  const created = await db.transaction('rw', db.events, db.outbox, async () => {
    const running = (await runningEvents(db, ctx.babyId)).find((e) => isNursingEvent(e, typeId));
    if (running) throw new PresetAlreadyRunningError('nursing', running.id);
    const recent = await eventsStartedSince(
      db,
      ctx.babyId,
      new Date(when.getTime() - 7 * DAY_MS).toISOString(),
    );
    const side = ctx.side ?? suggestedStartSide(recent, typeId).side;
    const payload: EventPayload = { method: 'breast', side };
    setOwn<unknown>(payload, SIDE_SINCE_KEY, iso);
    return createEvent(
      db,
      { babyId: ctx.babyId, typeId, startedAt: iso, endedAt: null, payload },
      options,
    );
  });
  return { babyId: ctx.babyId, createdIds: [created.id], stopped: [], at: iso, shiftMinutes: 0 };
}

async function loadRunning(db: BabyRoutineDb, id: string): Promise<BabyEvent> {
  const event = await db.events.get(id);
  if (!event) throw new EventNotFoundError(id);
  if (event.deletedAt) throw new EventDeletedError(id);
  if (event.endedAt !== null) throw new EventAlreadyStoppedError(id);
  return event;
}

function editedToken(
  babyId: string,
  before: BabyEvent,
  after: BabyEvent,
  iso: string,
  stops: boolean,
) {
  return {
    babyId,
    createdIds: [],
    stopped: [],
    at: iso,
    shiftMinutes: 0,
    edited: [
      {
        id: before.id,
        before: { startedAt: before.startedAt, endedAt: before.endedAt, payload: before.payload },
        stamp: after.clientUpdatedAt ?? after.updatedAt,
        ...(stops ? { stops: true } : {}),
      },
    ],
  } satisfies UndoToken;
}

/**
 * Closes the open segment and continues on `to` (default: the other side). Tapping the side that
 * already runs changes nothing (an empty token).
 */
export async function switchSide(
  db: BabyRoutineDb,
  eventId: string,
  options: CommandOptions = {},
  to?: BreastSide,
): Promise<UndoToken> {
  const { when, iso, options: at } = tapMoment(options);
  return db.transaction('rw', db.events, db.outbox, async () => {
    const event = await loadRunning(db, eventId);
    const side = currentSide(event);
    const target = to ?? otherSide(side);
    if (target === side) return { babyId: event.babyId, createdIds: [], stopped: [], at: iso };
    const payload = closeSegment(event, when);
    setOwn<unknown>(payload, 'side', target);
    setOwn<unknown>(payload, SIDE_SINCE_KEY, iso);
    const after = await editEvent(db, eventId, { payload }, at);
    return editedToken(event.babyId, event, after, iso, false);
  });
}

/** Which sides were used, from the seconds (the running side when both are zero). */
function usedSides(left: number, right: number, running: BreastSide): 'left' | 'right' | 'both' {
  if (left > 0 && right > 0) return 'both';
  if (left > 0) return 'left';
  if (right > 0) return 'right';
  return running;
}

/** Closes the open segment and stops the session; undo re-opens it with the earlier payload. */
export async function stopNursing(
  db: BabyRoutineDb,
  eventId: string,
  options: CommandOptions = {},
): Promise<UndoToken> {
  const { iso, options: at } = tapMoment(options);
  return db.transaction('rw', db.events, db.outbox, async () => {
    const event = await loadRunning(db, eventId);
    const side = currentSide(event);
    const end = iso < event.startedAt ? event.startedAt : iso;
    const closed = closeSegment(event, new Date(end));
    const payload = withoutOwn(closed, SIDE_SINCE_KEY);
    const left = payloadNumber({ payload }, SECONDS_KEY.left) ?? 0;
    const right = payloadNumber({ payload }, SECONDS_KEY.right) ?? 0;
    setOwn<unknown>(payload, 'side', usedSides(left, right, side));
    setOwn<unknown>(payload, LAST_SIDE_KEY, side);
    const after = await finishEvent(db, eventId, payload, end, at);
    return editedToken(event.babyId, event, after, iso, true);
  });
}

/** Seconds field of a side (for the time shift of a stopped session). */
export const secondsKeyOf = (side: BreastSide) => SECONDS_KEY[side];
