import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import {
  useBodyWeight,
  useMedications,
  usePrescriptionCommands,
  usePrescriptions,
} from '../db/hooks';
import type { Medication, Prescription, Proposal } from '../db/models';
import { termsOf, type PrescriptionTerms } from '../db/prescriptionCommands';
import { Provenance } from '../proposals/Provenance';
import { Field } from '../ui/form';
import { announceUndo } from '../ui/undoNotice';
import {
  DiscardChoice,
  EditorBody,
  EditorFooter,
  EditorFrame,
  EditorHeader,
  PlainSummary,
  PrimaryAction,
} from './EditorShell';
import { DoseFields } from './DoseFields';
import { GuardrailNote } from './GuardrailNote';
import { ExtraFields } from './ExtraFields';
import { MedicationChooser } from './MedicationChooser';
import { ProposalSheet } from './ProposalSheet';
import { ScheduleFields } from './ScheduleFields';
import { useEditorForm } from './useEditorForm';
import { useProductForm } from './useProductForm';
import {
  emptyForm,
  formFromPrescription,
  lenientTerms,
  summaryText,
  toTerms,
  validateForm,
  type PrescriptionForm,
} from './prescriptionForm';

export interface PrescriptionSheetProps {
  /** `proposal`: the Doctor's editor (see the component). Default `prescription`. */
  mode?: 'prescription' | 'proposal';
  babyId: string;
  /** Edit this prescription; omit to add one. */
  prescription?: Prescription;
  /** Start a new prescription for this medication. */
  medicationId?: string;
  onDone: () => void;
  /** After a successful save (create or edit), before `onDone`. */
  onSaved?: (terms: PrescriptionTerms) => void;
  /** Proposal mode: the Doctor's server id, stored on a new proposal until the server echoes it. */
  authorUserId?: string | null;
  /** Proposal mode: edit this pending proposal. */
  proposal?: Proposal;
  /** Proposal mode: propose a change to this prescription (prefilled, replaces it on accept). */
  replaces?: Prescription;
  /** Proposal mode: propose a change to what an accepted proposal created, when it is not here. */
  replacesProposal?: Proposal;
  /** Proposal mode: after the proposal was written locally and queued. */
  onProposed?: (proposal: Proposal) => void;
}

/**
 * The prescription editor: what the doctor prescribed for one medication, as the parent entered
 * it. A live sentence at the top reads the rule back; the dose, the schedule (clock times, every N
 * hours, or as needed with a minimum interval and a daily maximum), a shared wait with other
 * medications, the course dates and notes follow. The doctor's prescription is the source for every
 * dose and interval the app shows; the footer says so. Mount only while open.
 *
 * With `mode="proposal"` it is the Doctor's editor instead: the same fields and validation, a
 * medicine picker that adds nothing to the baby's list, and "Send to parents" (`ProposalSheet`).
 */
export function PrescriptionSheet(props: PrescriptionSheetProps) {
  if (props.mode !== 'proposal') return <PrescriptionForSheet {...props} />;
  const { babyId, authorUserId, proposal, replaces, replacesProposal, onDone, onProposed } = props;
  return (
    <ProposalSheet
      babyId={babyId}
      authorUserId={authorUserId ?? null}
      onDone={onDone}
      {...(proposal ? { proposal } : {})}
      {...(replaces ? { replaces } : {})}
      {...(replacesProposal ? { replacesProposal } : {})}
      {...(onProposed ? { onSaved: onProposed } : {})}
    />
  );
}

function PrescriptionForSheet(props: PrescriptionSheetProps) {
  // The form starts from the medication's default dose, so it waits for the local catalog.
  const medications = useMedications(props.babyId);
  return medications ? <PrescriptionEditor {...props} medications={medications} /> : null;
}

function PrescriptionEditor({
  babyId,
  prescription,
  medicationId,
  medications,
  onDone,
  onSaved,
}: PrescriptionSheetProps & { medications: Medication[] }) {
  const { t } = useTranslation();
  const titleId = useId();
  const prescriptions = usePrescriptions(babyId);
  const weight = useBodyWeight(babyId);
  const commands = usePrescriptionCommands();
  const [initial] = useState<PrescriptionForm>(() =>
    prescription
      ? formFromPrescription(prescription)
      : {
          ...emptyForm(
            new Date(),
            medications.find((m) => m.id === medicationId),
          ),
          ...(medicationId ? { medicationId } : {}),
        },
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const editor = useEditorForm(initial, bodyRef);
  const { form, errors, saving, failure } = editor;
  const groups = useMemo(
    () =>
      [
        ...new Set(
          (prescriptions ?? []).map((p) => p.intervalGroup).filter((g): g is string => !!g),
        ),
      ].sort(),
    [prescriptions],
  );
  const summary = summaryText(lenientTerms(form));
  const productForm = useProductForm(
    medications.find((m) => m.id === form.medicationId)?.productId,
  );

  const chooseMedication = (medication: Medication) =>
    editor.edit({
      medicationId: medication.id,
      ...(form.amount === null && form.unit === '' && medication.defaultDosage
        ? { amount: medication.defaultDosage.amount, unit: medication.defaultDosage.unit }
        : {}),
    });

  const submit = async () => {
    if (!editor.accept(validateForm(form))) return;
    editor.setSaving(true);
    try {
      const terms = toTerms(form, prescription?.status ?? 'active');
      if (prescription) await commands.update(prescription.id, terms);
      else await commands.create(babyId, terms);
      onSaved?.(terms);
      onDone();
    } catch (error) {
      editor.setFailure(
        error instanceof Error ? describeApiError(error) : t('medications.editor.saveFailed'),
      );
      editor.setSaving(false);
    }
  };

  const toggleStatus = async () => {
    if (!prescription) return;
    editor.setSaving(true);
    try {
      await commands.setStatus(
        prescription.id,
        prescription.status === 'active' ? 'stopped' : 'active',
      );
      onDone();
    } catch (error) {
      editor.setFailure(describeApiError(error));
      editor.setSaving(false);
    }
  };

  const remove = async () => {
    if (!prescription) return;
    const deleted = termsOf(prescription);
    await commands.remove(prescription.id);
    announceUndo(t('medications.prescriptionDeleted'), async () => {
      await commands.create(babyId, deleted);
    });
    onDone();
  };

  const problems = Object.keys(errors).length;
  const note = problems > 0 ? t('medications.editor.problems', { count: problems }) : failure;
  const editing = prescription !== undefined;
  const close = () => editor.requestClose(onDone);

  return (
    <EditorFrame titleId={titleId} onClose={close}>
      <EditorHeader
        titleId={titleId}
        title={editing ? t('medications.editor.titleEdit') : t('medications.editor.titleNew')}
        onClose={close}
      />
      <EditorBody ref={bodyRef}>
        {prescription && <Provenance prescription={prescription} />}
        <PlainSummary text={summary} />
        <Box data-field-key="medication">
          <Field
            label={t('medications.editor.medication')}
            required
            group
            error={errors.medication}
          >
            <MedicationChooser
              babyId={babyId}
              value={form.medicationId}
              onChange={chooseMedication}
            />
          </Field>
        </Box>
        <DoseFields
          form={form}
          errors={errors}
          weight={weight ?? null}
          productForm={productForm}
          onChange={editor.edit}
        />
        <ScheduleFields form={form} errors={errors} onChange={editor.edit} />
        <ExtraFields form={form} errors={errors} groups={groups} onChange={editor.edit} />
      </EditorBody>
      <EditorFooter>
        <GuardrailNote />
        {editor.discarding ? (
          <DiscardChoice onKeep={() => editor.setDiscarding(false)} onDiscard={onDone} />
        ) : (
          <>
            <Box role="status" sx={{ color: 'error.main', fontSize: '0.875rem' }}>
              {note}
            </Box>
            <PrimaryAction label={t('common.save')} saving={saving} onClick={() => void submit()} />
            {editing && (
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between' }}>
                <Button
                  disabled={saving}
                  onClick={() => void toggleStatus()}
                  sx={{ minHeight: 48 }}
                >
                  {prescription.status === 'active'
                    ? t('medications.editor.stop')
                    : t('medications.editor.resume')}
                </Button>
                <Button
                  color="error"
                  disabled={saving}
                  onClick={() => void remove()}
                  sx={{ minHeight: 48 }}
                >
                  {t('medications.editor.delete')}
                </Button>
              </Box>
            )}
          </>
        )}
      </EditorFooter>
    </EditorFrame>
  );
}
