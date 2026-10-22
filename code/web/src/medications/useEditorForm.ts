import { useState, type RefObject } from 'react';
import type { FormErrors, PrescriptionForm } from './prescriptionForm';

/**
 * The state both editors (the prescription and the proposal) share: the form, its field errors,
 * the saving and failure state, and the "Discard your changes?" step. `initial` must be the same
 * object for the lifetime of the editor (read it from a `useState` initializer). `bodyRef` is the
 * scrolling body, where the first invalid field is looked up and focused.
 */
export function useEditorForm(
  initial: PrescriptionForm,
  bodyRef: RefObject<HTMLDivElement | null>,
) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const edit = (patch: Partial<PrescriptionForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  /** Asks before closing a dirty editor; closes at once otherwise. */
  const requestClose = (onDone: () => void) => {
    if (saving) return;
    if (dirty) setDiscarding(true);
    else onDone();
  };

  /** Shows the problems and focuses the first invalid field; `true` when there are none. */
  const accept = (found: FormErrors): boolean => {
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length === 0) return true;
    setTimeout(
      () => bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      0,
    );
    return false;
  };

  return {
    form,
    errors,
    saving,
    failure,
    discarding,
    dirty,
    edit,
    requestClose,
    accept,
    setSaving,
    setFailure,
    setDiscarding,
  };
}
