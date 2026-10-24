import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '../api/errorMessages';
import { useDatabase } from '../db/DatabaseContext';
import { editEvent, finishEvent } from '../db/eventCommands';
import type { EventPayload, EventType } from '../db/models';
import { PAUSE_KEYS, SEGMENT_START_KEY } from '../timers/pauseMath';
import { useEventTypeText } from '../i18n/eventTypeText';
import { getOwn, setOwn, withOwn } from '../util/ownProperty';
import type { EventSheetProps } from './eventSheetTypes';
import {
  buildPayload,
  buildTimes,
  formProblems,
  defaultRunning,
  initialForm,
  pruneHiddenValues,
  switchFormType,
  type EventFormState,
  type FormProblem,
} from './formModel';
import { quickStartPayload, readLastUsed, recordLastUsed } from './lastUsedValues';
import { fillEmptyFields } from './stopPlan';
import { useFormulaChoice } from '../formulas/useFormulaChoice';
import { setCryConfirmed } from '../cryMonitor/autoSpells';
import { CRY_CONFIRMED_KEY, cryAnswer, isAutoDetected } from './cryDetection';
import { deleteEventWithWakeUp, editFollowingWakeUp } from '../now/nightEndsWakeUp';
import { createEventStoppingFeeding } from '../now/sleepStopsFeeding';
import { loadTimeBottles } from '../presets/timeBottlesStorage';

/** Required choices that are never pre-selected: a wrong silent value costs more than one tap. */
const NEVER_DEFAULT: ReadonlyMap<string, string> = new Map([['diaper', 'content']]);

/** Form values for a new event of `type`: the last used value of every required choice. */
function defaultValues(babyId: string, type: EventType | undefined): EventFormState['values'] {
  if (!type) return {};
  const remembered = { ...readLastUsed(babyId, type.id) };
  const skipped = type.babyId === null ? NEVER_DEFAULT.get(type.key) : undefined;
  if (skipped) delete remembered[skipped];
  const values: EventFormState['values'] = {};
  for (const [key, value] of Object.entries(quickStartPayload(type, {}, remembered))) {
    setOwn(values, key, typeof value === 'number' ? String(value) : (value as string | boolean));
  }
  return pruneHiddenValues(values, type);
}

/**
 * What an edit keeps of the stored payload besides the form's own values: the reserved pause keys
 * and the open nursing segment (valid for any type, never drawn), and, with the same type, the
 * values of its hidden fields (a deprecated `mood`). Other members the form does not know are
 * dropped, as before.
 */
function editBase(stored: EventPayload, type: EventType, sameType: boolean): EventPayload {
  const keep = new Set<string>([...PAUSE_KEYS, SEGMENT_START_KEY]);
  if (sameType) for (const field of type.fields) if (field.hidden === true) keep.add(field.key);
  const kept: EventPayload = {};
  for (const key of keep) {
    const value = getOwn(stored, key);
    if (value !== undefined) setOwn<unknown>(kept, key, value);
  }
  return kept;
}

function startForm({ babyId, types, event, initialTypeId, prefill, finish }: EventSheetProps) {
  const form = initialForm(types, event ?? prefill, initialTypeId, new Date());
  const type = types.find((candidate) => candidate.id === form.typeId);
  if (finish?.initialValues) {
    return {
      ...form,
      values: pruneHiddenValues({ ...finish.initialValues, ...form.values }, type),
    };
  }
  if (event || prefill) return form;
  return { ...form, values: { ...defaultValues(babyId, type), ...form.values } };
}

/** What changing the type did, so the banner can say it and Undo can go back. */
export interface TypeSwitch {
  name: string;
  cleared: boolean;
  previous: EventFormState;
}

/**
 * State and commands of the event sheet: the form, its problems (shown under the fields, the first
 * one focused after a failed save), type switching with undo, saving (create, edit or finish) and
 * deleting. The rules live in `formModel`, `payloadRules` and `lastUsedValues`.
 */
export function useEventSheetForm(props: EventSheetProps) {
  const { babyId, types, event, finish, onDone } = props;
  const { t } = useTranslation();
  const names = useEventTypeText();
  const db = useDatabase();
  const [form, setForm] = useState<EventFormState>(() => startForm(props));
  const [initial] = useState(() => JSON.stringify(form));
  const [openedAt] = useState(() => new Date());
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const [focusTick, setFocusTick] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [switched, setSwitched] = useState<TypeSwitch | null>(null);
  // A new bottle is timed only with the "Time bottle feedings" setting; stored events keep their times.
  const [timeBottles] = useState(() => !!event || loadTimeBottles());
  // A cry monitor spell's "Was she crying?" answer: saved at once, and kept by a later Save.
  const [crying, setCrying] = useState<boolean | null>(() => (event ? cryAnswer(event) : null));
  const cryQuestion = !!event && isAutoDetected(event);

  const type = types.find((candidate) => candidate.id === form.typeId);
  const formula = useFormulaChoice({ babyId, type, event, finish, values: form.values, setForm });
  const dirty = JSON.stringify(form) !== initial;
  // Solid food or a bedtime marker is a moment, not a timer; a finished event keeps its own length.
  const instant =
    !!type?.hasDuration &&
    !defaultRunning(type, form.values, timeBottles) &&
    (!event || event.endedAt === null || event.endedAt === event.startedAt);

  const edit = (changes: Partial<EventFormState>) => {
    setSwitched(null);
    setForm((f) => ({ ...f, ...changes }));
  };
  const setValue = (key: string, value: string | boolean) => {
    setSwitched(null);
    setForm((f) => ({ ...f, values: pruneHiddenValues(withOwn(f.values, key, value), type) }));
  };

  const changeType = (next: EventType) => {
    if (next.id === form.typeId) return;
    const result = switchFormType(form, type, next);
    const values = { ...defaultValues(babyId, next), ...result.form.values };
    setSwitched({ name: names.typeName(next), cleared: result.cleared, previous: form });
    setForm({ ...result.form, values: pruneHiddenValues(values, next) });
    setProblems([]);
  };
  const undoSwitch = () => {
    if (switched) setForm(switched.previous);
    setSwitched(null);
  };

  const persist = async (selected: EventType) => {
    // A bottle of formula left on the preselected formula names it (see `useFormulaChoice`).
    const toSave = { ...form, values: formula.valuesToSave(form.values) };
    if (event && finish) {
      const built = buildPayload(toSave, selected, event.payload);
      const payload = finish.restricted
        ? fillEmptyFields(event.payload, built, finish.fields)
        : built;
      // Finishing a running night ends it: its wake-up is logged in the same transaction.
      await editFollowingWakeUp(db, event, () =>
        finishEvent(db, event.id, payload, finish.endedAt),
      );
      return payload;
    }
    const times = buildTimes(toSave, selected, instant);
    const base = event ? editBase(event.payload, selected, event.typeId === selected.id) : {};
    if (event && crying !== null && event.typeId === selected.id) {
      setOwn<unknown>(base, CRY_CONFIRMED_KEY, crying);
    }
    const payload = buildPayload(toSave, selected, base);
    const data = { typeId: selected.id, ...times, payload, notes: toSave.notes.trim() || null };
    await (event
      ? editFollowingWakeUp(db, event, () => editEvent(db, event.id, data))
      : createEventStoppingFeeding(db, { babyId, ...data }));
    return payload;
  };

  const submit = async () => {
    const found = formProblems(form, type, names, { instant });
    setProblems(found);
    setSaveError(null);
    if (found.length > 0 || !type) {
      setFocusTick((tick) => tick + 1);
      return;
    }
    setSaving(true);
    try {
      recordLastUsed(babyId, type, await persist(type));
      onDone();
    } catch (error) {
      setSaveError(error instanceof Error ? describeApiError(error) : t('events.saveFailed'));
      setSaving(false);
    }
  };

  const answerCry = async (next: boolean) => {
    if (!event) return;
    const previous = crying;
    setCrying(next);
    try {
      await setCryConfirmed(db, event.id, next);
    } catch {
      setCrying(previous);
    }
  };

  const remove = async () => {
    if (!event) return null;
    // A night takes its automatic wake-up with it (see `deleteEventWithWakeUp`).
    return deleteEventWithWakeUp(db, event.id);
  };

  const problemFor = (key: string) => problems.find((p) => p.field === key)?.message;
  const errors: Record<string, string> = {};
  for (const problem of problems)
    if (!getOwn(errors, problem.field)) setOwn(errors, problem.field, problem.message);

  return {
    form,
    type,
    dirty,
    instant,
    openedAt,
    problems,
    errors,
    problemFor,
    focusTick,
    saveError,
    saving,
    switched,
    formula,
    edit,
    setValue,
    changeType,
    undoSwitch,
    submit,
    remove,
    cryQuestion,
    crying,
    answerCry,
  };
}
