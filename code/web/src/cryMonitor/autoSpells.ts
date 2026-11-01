import type { BabyRoutineDb } from '../db/database';
import { createEvent, editEvent, stopEvent, type CommandOptions } from '../db/eventCommands';
import { EventNotFoundError } from '../db/errors';
import type { BabyEvent, EventType } from '../db/models';
import { runningEvents } from '../db/queries';
import { AUTO_DETECTED_KEY, CRY_CONFIRMED_KEY, isAutoDetected } from '../events/cryDetection';
import { typeForKey, typeIdsForKey } from '../now/eventFacts';
import { FUSSY_KEY } from '../now/fussyPattern';

/*
 * The cry monitor's fussy spells (docs/design/31-cry-detector-spike.md section 8, docs/design/35 section 8),
 * through the normal local commands: client GUID, Dexie and the outbox, so the monitor works offline
 * and the spell syncs later; the server records the signed-in member as its author.
 *
 * - `cry_started{at}` starts a running spell of the baby's `fussy` type at `at` with only
 *   `auto_detected: true` (never a cause or what helped). A running auto spell of the baby (another
 *   monitor, or an earlier start) is kept instead: one episode, one spell. A running spell started by
 *   hand means a parent is already tracking it: nothing is created.
 * - `cry_ended{at}` ends the spell the monitor started or kept, at `at` (the end of the last crying
 *   window, not when the end became known). A spell somebody already stopped or deleted stays as it is.
 * - "Yes, crying" / "Not crying" set `cry_confirmed`; "Not crying" keeps the record (it can be
 *   deleted like any entry), and the readers leave it out (events/cryDetection.ts).
 */

export type AutoSpellStart =
  /** A new running spell. */
  | { kind: 'created'; id: string }
  /** A running monitor spell of the baby was kept. */
  | { kind: 'kept'; id: string }
  /** A spell started by hand is running: the monitor creates nothing and will end nothing. */
  | { kind: 'manual'; id: string }
  /** The baby has no fussy type (nothing can be logged). */
  | { kind: 'noType' };

export type AutoSpellEnd = 'ended' | 'alreadyEnded' | 'gone';

export interface AutoSpellInput {
  babyId: string;
  types: readonly EventType[];
  options?: CommandOptions;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The baby's running fussy spells, newest first. */
async function runningSpells(db: BabyRoutineDb, babyId: string, types: readonly EventType[]) {
  const ids = typeIdsForKey(types, FUSSY_KEY);
  return (await runningEvents(db, babyId))
    .filter((event) => ids.has(event.typeId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Starts (or keeps) the monitor's spell for a cry that started at `at` (epoch ms). */
export async function startAutoSpell(
  db: BabyRoutineDb,
  input: AutoSpellInput,
  at: number,
): Promise<AutoSpellStart> {
  const type = typeForKey(input.types, FUSSY_KEY);
  if (!type) return { kind: 'noType' };
  const now = (input.options?.now?.() ?? new Date()).getTime();
  return db.transaction('rw', db.events, db.outbox, async () => {
    const running = await runningSpells(db, input.babyId, input.types);
    const auto = running.find(isAutoDetected);
    if (auto) return { kind: 'kept', id: auto.id };
    const manual = running[0];
    if (manual) return { kind: 'manual', id: manual.id };
    const payload: BabyEvent['payload'] = {};
    payload[AUTO_DETECTED_KEY] = true;
    const created = await createEvent(
      db,
      {
        babyId: input.babyId,
        typeId: type.id,
        startedAt: iso(Math.min(at, now)),
        endedAt: null,
        payload,
      },
      input.options,
    );
    return { kind: 'created', id: created.id };
  });
}

/** Ends the monitor's spell `id` at `at` (never before its start, never past now). */
export async function endAutoSpell(
  db: BabyRoutineDb,
  id: string,
  at: number,
  options: CommandOptions = {},
): Promise<AutoSpellEnd> {
  const now = (options.now?.() ?? new Date()).getTime();
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await db.events.get(id);
    if (!current || current.deletedAt) return 'gone';
    if (current.endedAt !== null) return 'alreadyEnded';
    const end = Math.max(Math.min(at, now), Date.parse(current.startedAt));
    await stopEvent(db, id, iso(end), options);
    return 'ended';
  });
}

/** The parent's answer to "Was she crying?" (`true` crying, `false` not crying). */
export async function setCryConfirmed(
  db: BabyRoutineDb,
  id: string,
  confirmed: boolean,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await db.events.get(id);
    if (!current) throw new EventNotFoundError(id);
    const payload = { ...current.payload };
    payload[CRY_CONFIRMED_KEY] = confirmed;
    return editEvent(db, id, { payload }, options);
  });
}
