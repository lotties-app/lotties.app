import { useState, type ReactNode } from 'react';
import { useEventCommands } from '../db/hooks';
import type { BabyEvent, EventType } from '../db/models';
import type { FinishMode } from './eventSheetTypes';
import { EventSheet } from './EventSheet';
import { readLastUsed } from './lastUsedValues';
import { fixFields, planStop, rememberedFormValues } from './stopPlan';

interface Finishing {
  event: BabyEvent;
  finish: FinishMode;
}

export interface StopTimer {
  /**
   * Stops a running timer, or opens "Finish this ..." when required fields are missing (the stop
   * is committed when that sheet is saved). Resolves with the stopped event, or `null` when the
   * sheet opened instead. `endedAt` ends the timer then instead of now (a forgotten timer).
   */
  stop: (event: BabyEvent, endedAt?: string) => Promise<BabyEvent | null>;
  /** Opens "Finish this ..." for an event the server rejected (Settings > Sync > Fix). */
  fix: (event: BabyEvent, rejectedField?: string | null) => void;
  /** The sheet, while open; render it. */
  sheet: ReactNode;
}

function finishMode(babyId: string, type: EventType, fields: string[]): FinishMode {
  const remembered = readLastUsed(babyId, type.id);
  const all = type.fields.map((f) => f.key);
  return { fields, initialValues: rememberedFormValues(type, all, remembered) };
}

/** Stop and fix actions that never send a stop the server would reject (see `planStop`). */
export function useStopTimer(babyId: string, types: EventType[]): StopTimer {
  const commands = useEventCommands();
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const typeOf = (event: BabyEvent) => types.find((candidate) => candidate.id === event.typeId);

  const stop = async (event: BabyEvent, endedAt?: string) => {
    const type = typeOf(event);
    const plan = planStop(type, event.payload);
    if (plan.kind === 'stop') return commands.stop(event.id, endedAt);
    if (plan.kind === 'strip') return commands.finish(event.id, plan.payload, endedAt);
    setFinishing({ event, finish: finishMode(babyId, type!, plan.fields) });
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
