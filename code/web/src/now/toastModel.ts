import type { EventType } from '../db/models';
import type { UndoToken } from '../presets/actions';
import type { Receipt } from './nowText';

/*
 * State of the receipt toast (docs/design/03-interaction.md section 2): one at a time, 6 s, paused
 * while touched or focused, restarted by a time shift. A pure reducer: the clock comes in actions.
 */

export const TOAST_MS = 6_000;

export interface ToastEntry {
  token: UndoToken;
  receipt: Receipt;
  /** The baby's types (the message names built-in options in the active language). */
  types: readonly EventType[];
  /** The baby's birth date: time shifts never move before it. */
  birthDate?: string;
}

export interface ToastState {
  /** Increases with every toast shown (timers and late results check it). */
  id: number;
  entry: ToastEntry | null;
  /** Epoch ms when the toast hides; `null` while paused or hidden. */
  deadline: number | null;
  /** Ms left while paused. */
  remaining: number;
}

export type ToastAction =
  | { type: 'show'; entry: ToastEntry; now: number }
  | { type: 'token'; id: number; token: UndoToken; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'hide'; id?: number };

export const INITIAL_TOAST: ToastState = {
  id: 0,
  entry: null,
  deadline: null,
  remaining: TOAST_MS,
};

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case 'show':
      return {
        id: state.id + 1,
        entry: action.entry,
        deadline: action.now + TOAST_MS,
        remaining: TOAST_MS,
      };
    case 'token':
      if (action.id !== state.id || !state.entry) return state;
      // A shift restarts the countdown (paused toasts stay paused with a full countdown).
      return {
        ...state,
        entry: { ...state.entry, token: action.token },
        deadline: state.deadline === null ? null : action.now + TOAST_MS,
        remaining: TOAST_MS,
      };
    case 'pause':
      if (!state.entry || state.deadline === null) return state;
      return { ...state, deadline: null, remaining: Math.max(0, state.deadline - action.now) };
    case 'resume':
      if (!state.entry || state.deadline !== null) return state;
      return { ...state, deadline: action.now + state.remaining };
    case 'hide':
      if (action.id !== undefined && action.id !== state.id) return state;
      return { ...state, entry: null, deadline: null, remaining: TOAST_MS };
  }
}
