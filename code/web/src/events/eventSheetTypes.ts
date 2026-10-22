import type { BabyEvent, EventType } from '../db/models';
import type { EventFormState, FormPrefill } from './formModel';

/** Compact mode: only these fields (and the ones they reveal); saving completes the event. */
export interface FinishMode {
  fields: readonly string[];
  /** Values to pre-select (remembered last-used values), by field key. */
  initialValues?: EventFormState['values'];
  /** End of a running timer stopped through this form (a forgotten timer); default now. */
  endedAt?: string;
  /**
   * Someone else's timer stopped by a Caregiver: the save keeps every stored value and only fills
   * `fields` that were empty (the one change the role allows, see `isRunningControlChange`).
   */
  restricted?: boolean;
}

export interface EventSheetProps {
  babyId: string;
  types: EventType[];
  /** Existing event to edit; omit to create. */
  event?: BabyEvent;
  initialTypeId?: string;
  /** Starting values of a new event (a `sheet` preset). */
  prefill?: FormPrefill;
  /** With `event`: the "Finish this ..." form of a timer stopped without its required fields. */
  finish?: FinishMode;
  onDone: () => void;
}
