import { useMemo } from 'react';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby, EventType } from '../db/models';
import type { UndoToken } from '../presets/actions';
import { logCrySpell, type CryAnswer } from './crySpell';
import { useQuickLogToastContext } from './QuickLogToastContext';
import type { SleepKind } from './nowState';
import type { Receipt } from './nowText';
import {
  currentSide,
  nursingElapsed,
  startNursing,
  stopNursing,
  switchSide,
  type BreastSide,
} from './nursing';
import { runTrayChoice, type TrayChoice } from './quickLog';
import { isEmptyToken, runSleepAction, type SleepActionKind } from './sleepToggle';

export interface NowCommands {
  /** Runs a sleep action; `sleepKind` names the sleep a Fell asleep starts (for the toast). */
  sleep: (action: SleepActionKind, sleepKind?: SleepKind) => Promise<UndoToken>;
  /** Logs a tray choice (`minutesAgo` = the tray's "When" chip). */
  tray: (choice: TrayChoice, minutesAgo?: number) => Promise<UndoToken>;
  startNursing: (side?: BreastSide) => Promise<UndoToken>;
  switchSide: (eventId: string, to?: BreastSide) => Promise<UndoToken>;
  stopNursing: (eventId: string) => Promise<UndoToken>;
  /** Logs the "What worked?" answer of "Why is she crying?" as one fussy spell. */
  crySpell: (answer: CryAnswer) => Promise<UndoToken>;
}

/**
 * The Now commands for one baby. Each writes locally (events + outbox) and, inside a
 * `QuickLogToastProvider`, shows the receipt toast (Undo, time shift). Errors are thrown to the
 * caller (e.g. `PresetAlreadyRunningError`, `TrayChoiceInvalidError`).
 */
export function useNowCommands(
  baby: Pick<Baby, 'id' | 'birthDate'>,
  types: readonly EventType[],
): NowCommands {
  const db = useDatabase();
  const toast = useQuickLogToastContext();
  const show = toast?.show;

  return useMemo(() => {
    const babyId = baby.id;
    const receipt = (token: UndoToken, value: Receipt) => {
      if (!isEmptyToken(token)) show?.({ token, receipt: value, types, birthDate: baby.birthDate });
      return token;
    };
    const sideOf = async (eventId: string) => {
      const event = await db.events.get(eventId);
      return event ? currentSide(event) : 'left';
    };

    return {
      sleep: async (action, sleepKind) =>
        receipt(await runSleepAction(db, action, { babyId, types }), {
          kind: 'sleep',
          action,
          ...(sleepKind ? { sleepKind } : {}),
        }),
      tray: async (choice, minutesAgo) => {
        const token = await runTrayChoice(db, choice, { babyId, types, minutesAgo });
        if (choice.kind !== 'breast') return receipt(token, { kind: 'tray', choice });
        return receipt(token, { kind: 'nursing_started', side: await sideOf(token.createdIds[0]) });
      },
      startNursing: async (side) => {
        const token = await startNursing(db, { babyId, types, ...(side ? { side } : {}) });
        return receipt(token, { kind: 'nursing_started', side: await sideOf(token.createdIds[0]) });
      },
      switchSide: async (eventId, to) => {
        const token = await switchSide(db, eventId, {}, to);
        return receipt(token, { kind: 'nursing_switched', side: await sideOf(eventId) });
      },
      stopNursing: async (eventId) => {
        const token = await stopNursing(db, eventId);
        const stopped = await db.events.get(eventId);
        const elapsed = stopped ? nursingElapsed(stopped, new Date()) : { left: 0, right: 0 };
        return receipt(token, {
          kind: 'nursing_stopped',
          leftSeconds: elapsed.left,
          rightSeconds: elapsed.right,
        });
      },
      crySpell: async (answer) =>
        receipt(await logCrySpell(db, { ...answer, babyId, types }), {
          kind: 'cry_spell',
          chip: answer.chip,
        }),
    } satisfies NowCommands;
  }, [db, baby.id, baby.birthDate, types, show]);
}
