import type { BabyRoutineDb } from '../db/database';
import { editEvent, type CommandOptions } from '../db/eventCommands';
import type { BabyEvent, EventPayload } from '../db/models';
import type { EditedEvent, UndoToken } from '../presets/actions';
import { setOwn } from '../util/ownProperty';
import { MINUTE_MS, payloadNumber, payloadString } from './eventFacts';
import { LAST_SIDE_KEY, SIDE_SINCE_KEY, parseBreastSide, secondsKeyOf } from './nursing';

/*
 * The toast's time-shift chips (Now / -5 / -10 / -15 min, docs/design/03-interaction.md section 2):
 * "she fell asleep 10 minutes ago" with no time picker. Edits go through `editEvent`, so they are
 * queued in the outbox with a fresh client edit time like any other edit.
 */

/** Minutes offered by the toast chips (0 = "Now", the tap moment). */
export const SHIFT_CHOICES = [0, 5, 10, 15] as const;

export class TokenNotShiftableError extends Error {
  constructor() {
    super('The undo token has no command moment (`at`) to shift from.');
    this.name = 'TokenNotShiftableError';
  }
}

export interface ShiftOptions {
  /** Baby's birth date (`yyyy-mm-dd`): nothing moves before its local midnight. */
  birthDate?: string;
  /** Clock (tests); also the edit time of the changes. */
  now?: () => Date;
}

function birthStart(birthDate: string | undefined): number {
  const match = birthDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate) : null;
  if (!match) return Number.NEGATIVE_INFINITY;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

const isLive = (event: BabyEvent | undefined): event is BabyEvent =>
  event !== undefined && event.deletedAt === null;

const laterIso = (a: string, b: string) => (a > b ? a : b);

/** A created event: a running timer moves its start, an instant moves start and end. */
async function shiftCreated(db: BabyRoutineDb, id: string, target: string, cmd: CommandOptions) {
  const event = await db.events.get(id);
  if (!isLive(event)) return;
  if (event.endedAt === null) {
    const payload: EventPayload = { ...event.payload };
    // A nursing session that never switched sides: its open segment starts with the session.
    if (payloadString(event, SIDE_SINCE_KEY) === event.startedAt) {
      setOwn<unknown>(payload, SIDE_SINCE_KEY, target);
    }
    await editEvent(db, id, { startedAt: target, payload }, cmd);
  } else if (event.endedAt === event.startedAt) {
    await editEvent(db, id, { startedAt: target, endedAt: target }, cmd);
  } else if (target <= event.endedAt) {
    await editEvent(db, id, { startedAt: target }, cmd);
  }
}

/** A stopped timer moves its end (never before its start). */
async function shiftStopped(
  db: BabyRoutineDb,
  stop: UndoToken['stopped'][number],
  target: string,
  cmd: CommandOptions,
) {
  const event = await db.events.get(stop.id);
  if (!isLive(event) || event.endedAt !== stop.endedAt) return stop;
  const after = await editEvent(db, stop.id, { endedAt: laterIso(target, event.startedAt) }, cmd);
  return { id: stop.id, endedAt: after.endedAt ?? stop.endedAt };
}

/** The payload of a stopped nursing session with the last side's seconds moved by `deltaMs`. */
function nursingPayloadAfterShift(event: BabyEvent, deltaMs: number): EventPayload {
  const payload: EventPayload = { ...event.payload };
  const side = parseBreastSide(payloadString(event, LAST_SIDE_KEY));
  if (!side) return payload;
  const key = secondsKeyOf(side);
  const seconds = payloadNumber(event, key) ?? 0;
  setOwn<unknown>(payload, key, Math.max(0, Math.round(seconds + deltaMs / 1000)));
  return payload;
}

/** An edited event the command stopped (e.g. a nursing stop) moves its end like a stop. */
async function shiftEdited(
  db: BabyRoutineDb,
  entry: EditedEvent,
  target: string,
  cmd: CommandOptions,
): Promise<EditedEvent> {
  const event = await db.events.get(entry.id);
  const stamp = event?.clientUpdatedAt ?? event?.updatedAt;
  if (!isLive(event) || stamp !== entry.stamp) return entry;
  if (!entry.stops || event.endedAt === null) return entry;
  const endedAt = laterIso(target, event.startedAt);
  const delta = Date.parse(endedAt) - Date.parse(event.endedAt);
  const after = await editEvent(
    db,
    entry.id,
    { endedAt, payload: nursingPayloadAfterShift(event, delta) },
    cmd,
  );
  return { ...entry, stamp: after.clientUpdatedAt ?? after.updatedAt };
}

/**
 * Moves what the command behind `token` logged to `minutes` before its moment (`token.at`; the
 * offset is absolute, so -10 then -5 ends at -5 and 0 restores the tap time): created timers move
 * their start, created instants their start and end, stopped timers their end. Clamped to not
 * before the baby's birth and not after now. Returns the token to keep (stops carry the new end, so
 * undo still re-opens them). Events edited or deleted since the command are left alone.
 */
export async function shiftEventStart(
  db: BabyRoutineDb,
  token: UndoToken,
  minutes: number,
  options: ShiftOptions = {},
): Promise<UndoToken> {
  if (!token.at) throw new TokenNotShiftableError();
  const now = options.now?.() ?? new Date();
  const cmd: CommandOptions = { now: () => now };
  const wanted = Date.parse(token.at) - Math.max(0, minutes) * MINUTE_MS;
  const clamped = Math.min(now.getTime(), Math.max(birthStart(options.birthDate), wanted));
  const target = new Date(clamped).toISOString();

  return db.transaction('rw', db.events, db.outbox, async () => {
    for (const id of token.createdIds) await shiftCreated(db, id, target, cmd);
    const stopped: UndoToken['stopped'] = [];
    for (const stop of token.stopped) stopped.push(await shiftStopped(db, stop, target, cmd));
    const edited: EditedEvent[] = [];
    for (const entry of token.edited ?? []) edited.push(await shiftEdited(db, entry, target, cmd));
    return {
      ...token,
      stopped,
      ...(token.edited ? { edited } : {}),
      shiftMinutes: Math.max(0, minutes),
    };
  });
}

/** Whether the toast should offer the shift chips for this token. */
export function isShiftable(token: UndoToken): boolean {
  return (
    token.at !== undefined &&
    (token.createdIds.length > 0 ||
      token.stopped.length > 0 ||
      (token.edited ?? []).some((entry) => entry.stops === true))
  );
}
