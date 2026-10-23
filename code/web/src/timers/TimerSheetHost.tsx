import { useState } from 'react';
import type { EventAccess } from '../baby/useEventAccess';
import type { BabyEvent, EventType } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import type { PresetActions } from '../presets/usePresetActions';
import { TimerSheet } from './TimerSheet';
import type { TimerCommands } from './useTimerCommands';

interface Props {
  babyId: string;
  types: EventType[];
  /** The running timer whose sheet is open; nothing renders without one. */
  event: BabyEvent | undefined;
  readOnly: boolean;
  access: Pick<EventAccess, 'lockedBy' | 'controlLockedBy'>;
  commands: TimerCommands;
  actions: Pick<PresetActions, 'stop'>;
  run: (action: () => Promise<unknown>) => void;
  onClose: () => void;
}

/**
 * The timer sheet of one running timer and the full event sheet its "Edit all details" opens:
 * shared by the mini timer bar and the "Running now" cards of the Now screen.
 */
export function TimerSheetHost({
  babyId,
  types,
  event,
  readOnly,
  access,
  commands,
  actions,
  run,
  onClose,
}: Props) {
  const [editing, setEditing] = useState<BabyEvent | null>(null);
  return (
    <>
      {event && (
        <TimerSheet
          babyId={babyId}
          types={types}
          event={event}
          readOnly={readOnly}
          lockedBy={access.lockedBy(event)}
          controlLockedBy={access.controlLockedBy(event)}
          commands={commands}
          run={run}
          onClose={onClose}
          onStop={(stopped, label) => {
            onClose();
            run(() => actions.stop(stopped, { name: label }));
          }}
          onEditAll={(edited) => {
            onClose();
            setEditing(edited);
          }}
        />
      )}
      {editing && (
        <EventSheet babyId={babyId} types={types} event={editing} onDone={() => setEditing(null)} />
      )}
    </>
  );
}
