import { useState, type ReactNode } from 'react';
import { canChangeEvent } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import { finishEvent, stopEvent } from '../db/eventCommands';
import type { BabyEvent, EventType } from '../db/models';
import { stopLoggingWakeUp } from '../now/nightEndsWakeUp';
import type { FinishMode } from './eventSheetTypes';
import { EventSheet } from './EventSheet';
import { readLastUsed } from './lastUsedValues';
import { fixFields, planStop, rememberedFormValues } from './stopPlan';

interface Finishing {
  event: BabyEvent;
  finish: FinishMode;
}

export interface StoppedTimer {
  stopped: BabyEvent;
  /** The Wake-up marker the stop logged because it ended a night (`null`: none). */
  wakeUpId: string | null;
}

export interface StopTimer {
  /**
   * Stops a running timer, or opens "Finish this ..." when required fields are missing (the stop
   * is committed when that sheet is saved). Resolves with the stopped event (and the wake-up a
   * stopped night logs, see `nightEndsWakeUp`), or `null` when the sheet opened instead. `endedAt`
   * ends the timer then instead of now (a forgotten timer).
   */
  stop: (event: BabyEvent, endedAt?: string) => Promise<StoppedTimer | null>;
  /** Opens "Finish this ..." for an event the server rejected (Settings > Sync > Fix). */
  fix: (event: BabyEvent, rejectedField?: string | null) => void;
  /** The sheet, while open; render it. */
  sheet: ReactNode;
}

function finishMode(
  babyId: string,
  type: EventType,
  fields: string[],
  endedAt?: string,
  restricted = false,
): FinishMode {
  const remembered = readLastUsed(babyId, type.id);
  // Someone else's timer: only the asked fields may be filled, so only they get remembered values.
  const all = restricted ? fields : type.fields.map((f) => f.key);
  return {
    fields,
    initialValues: rememberedFormValues(type, all, remembered),
    ...(endedAt ? { endedAt } : {}),
    ...(restricted ? { restricted } : {}),
  };
}

/** Stop and fix actions that never send a stop the server would reject (see `planStop`). */
export function useStopTimer(babyId: string, types: EventType[]): StopTimer {
  const db = useDatabase();
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const typeOf = (event: BabyEvent) => types.find((candidate) => candidate.id === event.typeId);

  const stop = async (event: BabyEvent, endedAt?: string) => {
    const type = typeOf(event);
    const plan = planStop(type, event.payload);
    if (plan.kind === 'stop') {
      return stopLoggingWakeUp(db, () => stopEvent(db, event.id, endedAt));
    }
    if (plan.kind === 'strip') {
      const payload = plan.payload;
      return stopLoggingWakeUp(db, () => finishEvent(db, event.id, payload, endedAt));
    }
    const baby = await db.babies.get(babyId);
    const restricted = !!baby && !canChangeEvent(baby, event);
    setFinishing({ event, finish: finishMode(babyId, type!, plan.fields, endedAt, restricted) });
    return null;
  };

  const fix = (event: BabyEvent, rejectedField?: string | null) => {
    const type = typeOf(event);
    if (!type) return;
    setFinishing({
      event,
      finish: finishMode(babyId, type, fixFields(type, event, rejectedField)),
    });
  };

  const sheet = finishing && (
    <EventSheet
      babyId={babyId}
      types={types}
      event={finishing.event}
      finish={finishing.finish}
      onDone={() => setFinishing(null)}
    />
  );

  return { stop, fix, sheet };
}
