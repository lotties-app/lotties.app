import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDatabase } from '../db/DatabaseContext';
import { undoPreset, type UndoToken } from '../presets/actions';
import { receiptMessage, type Receipt } from './nowText';
import { SHIFT_CHOICES, isShiftable, shiftEventStart } from './timeShift';
import { INITIAL_TOAST, toastReducer, type ToastEntry } from './toastModel';

export interface QuickLogToastView {
  /** Changes with every toast shown (use as the React key). */
  id: number;
  message: string;
  receipt: Receipt;
  token: UndoToken;
  /** Whether the time-shift chips apply. */
  shiftable: boolean;
  /** Minutes offered by the chips (0 = the tap moment). */
  shiftOptions: readonly number[];
  /** The selected chip. */
  shiftMinutes: number;
}

export interface QuickLogToast {
  /** The toast to render, or `null`. */
  current: QuickLogToastView | null;
  show: (entry: ToastEntry) => void;
  /** Reverts the command and hides the toast. */
  undo: () => Promise<void>;
  /** Moves the logged events to `minutes` before the tap (see `shiftEventStart`). */
  shift: (minutes: number) => Promise<void>;
  dismiss: () => void;
  /** Pause while hovered, touched or focused (WCAG 2.2.1); resume when left. */
  pause: () => void;
  resume: () => void;
  /** The last failed undo/shift, until the next toast or `clearError`. */
  error: unknown;
  clearError: () => void;
}

/**
 * The receipt toast state: one toast at a time with Undo and the time-shift chips, hidden after
 * 6 s unless paused. The view is rendered by the Now screen (wave 3b) through
 * `QuickLogToastContext`.
 */
export function useQuickLogToast(): QuickLogToast {
  const db = useDatabase();
  useTranslation();
  const [state, dispatch] = useReducer(toastReducer, INITIAL_TOAST);
  const [error, setError] = useState<unknown>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (state.deadline === null) return;
    const id = state.id;
    const timer = setTimeout(() => dispatch({ type: 'hide', id }), state.deadline - Date.now());
    return () => clearTimeout(timer);
  }, [state.deadline, state.id]);

  const show = useCallback((entry: ToastEntry) => {
    setError(null);
    dispatch({ type: 'show', entry, now: Date.now() });
  }, []);

  const undo = useCallback(async () => {
    const { entry, id } = stateRef.current;
    if (!entry) return;
    dispatch({ type: 'hide', id });
    try {
      await undoPreset(db, entry.token);
    } catch (e) {
      setError(e);
    }
  }, [db]);

  const shift = useCallback(
    async (minutes: number) => {
      const { entry, id } = stateRef.current;
      if (!entry || !isShiftable(entry.token)) return;
      try {
        const token = await shiftEventStart(db, entry.token, minutes, {
          ...(entry.birthDate ? { birthDate: entry.birthDate } : {}),
        });
        dispatch({ type: 'token', id, token, now: Date.now() });
      } catch (e) {
        setError(e);
      }
    },
    [db],
  );

  const dismiss = useCallback(() => dispatch({ type: 'hide' }), []);
  const pause = useCallback(() => dispatch({ type: 'pause', now: Date.now() }), []);
  const resume = useCallback(() => dispatch({ type: 'resume', now: Date.now() }), []);
  const clearError = useCallback(() => setError(null), []);

  const { entry, id } = state;
  // Rebuilt on every render (cheap), so a language change (useTranslation re-renders) updates it.
  const message = entry ? receiptMessage(entry.receipt, entry.token, entry.types) : '';
  const current = useMemo<QuickLogToastView | null>(() => {
    if (!entry) return null;
    return {
      id,
      message,
      receipt: entry.receipt,
      token: entry.token,
      shiftable: isShiftable(entry.token),
      shiftOptions: SHIFT_CHOICES,
      shiftMinutes: entry.token.shiftMinutes ?? 0,
    };
  }, [entry, id, message]);

  return useMemo(
    () => ({ current, show, undo, shift, dismiss, pause, resume, error, clearError }),
    [current, show, undo, shift, dismiss, pause, resume, error, clearError],
  );
}
