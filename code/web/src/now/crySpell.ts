import type { BabyRoutineDb } from '../db/database';
import { createEvent, editEvent, type CommandOptions } from '../db/eventCommands';
import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { runningEvents } from '../db/queries';
import { fillEmptyFields } from '../events/stopPlan';
import { PresetNotRunnableError, type UndoToken } from '../presets/actions';
import { setOwn } from '../util/ownProperty';
import type { CryCause } from './cryReasons';
import { typeForKey } from './eventFacts';
import { FUSSY_KEY } from './fussyPattern';

/*
 * The "What worked?" answer of the "Why is she crying?" sheet (docs/design/27-cry-reasons.md
 * section 9): one fussy spell from when the sheet opened until now, with `what_helped` and the
 * hidden `suggested_cause` (what the sheet ranked first). A fussy timer that already runs is stopped
 * and filled in instead, so the spell is never logged twice. Local first (events + outbox), undone
 * through the usual token.
 */

/** The chips of "What worked?", in their order, with the `what_helped` option each one saves. */
export const WHAT_WORKED = [
  ['fed', 'feeding'],
  ['changedDiaper', 'diaper_change'],
  ['slept', 'sleep'],
  ['burped', 'burping'],
  ['held', 'holding'],
  ['rocked', 'rocking'],
  ['pacifier', 'pacifier'],
  ['massage', 'massage'],
  ['nothingYet', 'nothing'],
] as const;
export type WhatWorkedChip = (typeof WHAT_WORKED)[number][0];
export type WhatHelpedOption = (typeof WHAT_WORKED)[number][1];

const WHAT_HELPED_FIELD = 'what_helped';
const SUGGESTED_CAUSE_FIELD = 'suggested_cause';
const FILLED_FIELDS = [WHAT_HELPED_FIELD, SUGGESTED_CAUSE_FIELD] as const;

/** The ranker's cause keys are the `suggested_cause` option keys. */
const SUGGESTED_OPTION: Readonly<Record<CryCause, string>> = {
  hunger: 'hunger',
  sleepy: 'sleepy',
  diaper: 'diaper',
  gas: 'gas',
  comfort: 'comfort',
};

function optionsOf(type: EventType, key: string): readonly string[] | null {
  const field = type.fields.find((f) => f.key === key);
  return field ? field.options : null;
}

/** The chips the baby's fussy type can save (an option the type lacks is not offered). */
export function whatWorkedChips(types: readonly EventType[]): WhatWorkedChip[] {
  const type = typeForKey(types, FUSSY_KEY);
  const options = type ? optionsOf(type, WHAT_HELPED_FIELD) : null;
  if (!options) return [];
  return WHAT_WORKED.filter(([, option]) => options.includes(option)).map(([chip]) => chip);
}

export function whatHelpedOf(chip: WhatWorkedChip): WhatHelpedOption {
  return (WHAT_WORKED.find(([key]) => key === chip) as (typeof WHAT_WORKED)[number])[1];
}

/** The payload values to save: only fields and options the type declares. */
function answerPayload(type: EventType, whatHelped: string, cause: CryCause | null): EventPayload {
  const payload: EventPayload = {};
  if (optionsOf(type, WHAT_HELPED_FIELD)?.includes(whatHelped)) {
    setOwn<unknown>(payload, WHAT_HELPED_FIELD, whatHelped);
  }
  const suggested = cause ? SUGGESTED_OPTION[cause] : null;
  if (suggested && optionsOf(type, SUGGESTED_CAUSE_FIELD)?.includes(suggested)) {
    setOwn<unknown>(payload, SUGGESTED_CAUSE_FIELD, suggested);
  }
  return payload;
}

/** What the sheet answers (the Now command adds the baby and its types). */
export interface CryAnswer {
  /** When the sheet opened: the start of a new spell. */
  openedAt: Date;
  chip: WhatWorkedChip;
  /** The cause ranked first when the sheet opened. */
  suggestedCause: CryCause | null;
  /** Whether the user may change the event (Caregivers: only their own). */
  canChange: (event: BabyEvent) => boolean;
  /** Whether the user may stop the running event (a Caregiver may stop someone else's). */
  canControl: (event: BabyEvent) => boolean;
}

export interface CrySpellInput extends CryAnswer {
  babyId: string;
  types: readonly EventType[];
  options?: CommandOptions;
}

/** The newest running fussy timer of the baby, if any. */
async function runningSpell(db: BabyRoutineDb, babyId: string, typeId: string) {
  return (await runningEvents(db, babyId))
    .filter((e) => e.typeId === typeId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/**
 * Logs the answer: stops the running fussy timer and fills in the answer (only empty values when
 * the user may not change someone else's entry), else creates one spell from `openedAt` to now.
 * The token has no command moment, so the toast offers Undo without the time-shift chips (moving
 * the start of a spell that already has a length would cut it short).
 */
export async function logCrySpell(db: BabyRoutineDb, input: CrySpellInput): Promise<UndoToken> {
  const type = typeForKey(input.types, FUSSY_KEY);
  if (!type) throw new PresetNotRunnableError(FUSSY_KEY);
  const now = input.options?.now?.() ?? new Date();
  const options: CommandOptions = { ...input.options, now: () => now };
  const answer = answerPayload(type, whatHelpedOf(input.chip), input.suggestedCause);
  const token: UndoToken = { babyId: input.babyId, createdIds: [], stopped: [] };

  await db.transaction('rw', db.events, db.outbox, async () => {
    const running = await runningSpell(db, input.babyId, type.id);
    if (running && input.canControl(running)) {
      const payload = input.canChange(running)
        ? { ...running.payload, ...answer }
        : fillEmptyFields(running.payload, answer, FILLED_FIELDS);
      const endedAt = new Date(Math.max(now.getTime(), Date.parse(running.startedAt)));
      const after = await editEvent(
        db,
        running.id,
        { endedAt: endedAt.toISOString(), payload },
        options,
      );
      token.edited = [
        {
          id: running.id,
          before: { startedAt: running.startedAt, endedAt: null, payload: running.payload },
          stamp: after.clientUpdatedAt ?? after.updatedAt,
          stops: true,
        },
      ];
      return;
    }
    const start = Math.min(input.openedAt.getTime(), now.getTime());
    const created = await createEvent(
      db,
      {
        babyId: input.babyId,
        typeId: type.id,
        startedAt: new Date(start).toISOString(),
        endedAt: now.toISOString(),
        payload: answer,
      },
      options,
    );
    token.createdIds.push(created.id);
  });
  return token;
}
