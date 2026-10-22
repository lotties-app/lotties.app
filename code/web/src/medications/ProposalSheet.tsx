import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { useBodyWeight, useMedications, usePrescriptions } from '../db/hooks';
import { InvalidProposalError } from '../db/proposalCommands';
import type { Medication, Prescription, Proposal } from '../db/models';
import { contentOf, proposalTermsOf, type ProposalTerms } from '../proposals/proposalModel';
import { useProposalCommands } from '../proposals/useProposals';
import { Field } from '../ui/form';
import { palette } from '../ui/form/styles';
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
import { ExtraFields } from './ExtraFields';
import { GuardrailNote } from './GuardrailNote';
import { ProposalMedicationChooser, type MedicationRef } from './ProposalMedicationChooser';
import { ScheduleFields } from './ScheduleFields';
import { useEditorForm } from './useEditorForm';
import { useProductForm } from './useProductForm';
import {
  emptyForm,
  formFromContent,
  lenientTerms,
  summaryText,
  toContent,
  todayKey,
  validateForm,
  type PrescriptionForm,
} from './prescriptionForm';

export interface ProposalSheetProps {
  babyId: string;
  /** The Doctor's server id: stored on a new proposal until the server echoes it. */
  authorUserId: string | null;
  /** Edit this pending proposal; omit to write a new one. */
  proposal?: Proposal;
  /** Propose a change to this prescription: prefilled with its content, replaces it on accept. */
  replaces?: Prescription;
  /**
   * Propose a change to the prescription an accepted proposal created, when that prescription is
   * not on this device: prefilled with the proposal's content.
   */
  replacesProposal?: Proposal;
  onDone: () => void;
  /** After the proposal was written locally (and queued), before `onDone`. */
  onSaved?: (proposal: Proposal) => void;
}

interface Start {
  ref: MedicationRef | null;
  form: PrescriptionForm;
  replacesPrescriptionId: string | null;
}

/** A change starts today: the old course ends the day the parents accept (and stays within it). */
function forChange(form: PrescriptionForm, today: string): PrescriptionForm {
  const endDate = form.endDate !== '' && form.endDate < today ? '' : form.endDate;
  return { ...form, startDate: today, endDate };
}

function startFor(
  { proposal, replaces, replacesProposal }: ProposalSheetProps,
  medications: readonly Medication[],
): Start {
  const now = new Date();
  const blank = emptyForm(now);
  if (proposal) {
    const terms = proposalTermsOf(proposal);
    return {
      ref: {
        medicationId: terms.medicationId,
        productId: terms.productId,
        name: terms.medicationName,
      },
      form: { ...blank, ...formFromContent(terms) },
      replacesPrescriptionId: terms.replacesPrescriptionId,
    };
  }
  if (replaces) {
    const medication = medications.find((m) => m.id === replaces.medicationId);
    return {
      ref: medication
        ? {
            medicationId: medication.id,
            productId: medication.productId ?? null,
            name: medication.name,
          }
        : null,
      form: forChange({ ...blank, ...formFromContent(replaces) }, todayKey(now)),
      replacesPrescriptionId: replaces.id,
    };
  }
  if (replacesProposal) {
    const terms = proposalTermsOf(replacesProposal);
    return {
      ref: {
        medicationId: terms.medicationId,
        productId: terms.productId,
        name: terms.medicationName,
      },
      form: forChange({ ...blank, ...formFromContent(terms) }, todayKey(now)),
      replacesPrescriptionId: replacesProposal.acceptedPrescriptionId,
    };
  }
  return { ref: null, form: blank, replacesPrescriptionId: null };
}

/**
 * The Doctor's prescription editor (docs/design/16-doctor-access.md section 10.5): the same editor
 * and the same validation as a prescription's, with a medicine picker that only names the medicine
 * (nothing is added to the baby's list), no prescriber, and "Send to parents". The parents review
 * it before anything changes. Mount only while open.
 */
export function ProposalSheet(props: ProposalSheetProps) {
  // The starting dose may come from the baby's medication, so it waits for the local list.
  const medications = useMedications(props.babyId);
  return medications ? <ProposalEditor {...props} medications={medications} /> : null;
}

function ProposalEditor(props: ProposalSheetProps & { medications: Medication[] }) {
  const {
    babyId,
    authorUserId,
    proposal,
    replaces,
    replacesProposal,
    medications,
    onDone,
    onSaved,
  } = props;
  const { t } = useTranslation();
  const titleId = useId();
  const commands = useProposalCommands();
  const prescriptions = usePrescriptions(babyId);
  const weight = useBodyWeight(babyId);
  const [start] = useState(() => startFor(props, medications));
  const bodyRef = useRef<HTMLDivElement>(null);
  const editor = useEditorForm(start.form, bodyRef);
  const { form, errors, saving, failure } = editor;
  const [ref, setRef] = useState<MedicationRef | null>(start.ref);
  const productForm = useProductForm(ref?.productId);
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
  const changing = replaces ?? replacesProposal;
  const replacedSummary = changing ? summaryText(contentOf(changing)) : null;
  const title = proposal
    ? t('proposals.sheet.titleEdit')
    : changing
      ? t('proposals.sheet.titleChange')
      : t('proposals.sheet.titleNew');

  const choose = (next: MedicationRef) => {
    setRef(next);
    editor.edit(
      form.amount === null && form.unit === '' && next.medicationId
        ? defaultDoseOf(medications, next.medicationId)
        : {},
    );
  };

  const submit = async () => {
    const found = validateForm(form, { medicationName: ref?.name ?? '' });
    if (!editor.accept(found) || !ref) return;
    editor.setSaving(true);
    try {
      const terms: ProposalTerms = {
        ...toContent(form),
        medicationId: ref.medicationId,
        productId: ref.productId,
        medicationName: ref.name,
        replacesPrescriptionId: start.replacesPrescriptionId,
      };
      const saved = proposal
        ? await commands.update(proposal.id, terms)
        : await commands.create(babyId, authorUserId, terms);
      onSaved?.(saved);
      onDone();
    } catch (error) {
      editor.setFailure(
        error instanceof InvalidProposalError && error.code === 'decided'
          ? t('proposals.sheet.alreadyDecided')
          : t('proposals.sheet.saveFailed'),
      );
      editor.setSaving(false);
    }
  };

  const withdraw = async () => {
    if (!proposal) return;
    editor.setSaving(true);
    await commands.withdraw(proposal.id);
    onDone();
  };

  const problems = Object.keys(errors).length;
  const note = problems > 0 ? t('medications.editor.problems', { count: problems }) : failure;

  return (
    <EditorFrame titleId={titleId} onClose={() => editor.requestClose(onDone)}>
      <EditorHeader titleId={titleId} title={title} onClose={() => editor.requestClose(onDone)} />
      <EditorBody ref={bodyRef}>
        {replacedSummary && <ReplacesNote summary={replacedSummary} />}
        <PlainSummary text={summary} />
        <Box data-field-key="medication">
          <Field
            label={t('medications.editor.medication')}
            required
            group
            error={errors.medication}
          >
            <ProposalMedicationChooser babyId={babyId} value={ref} onChange={choose} />
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
        <ExtraFields form={form} errors={errors} groups={groups} forDoctor onChange={editor.edit} />
      </EditorBody>
      <EditorFooter>
        <GuardrailNote />
        {editor.discarding ? (
          <DiscardChoice onKeep={() => editor.setDiscarding(false)} onDiscard={onDone} />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('proposals.sheet.reviewNote')}
            </Typography>
            <Box role="status" sx={{ color: 'error.main', fontSize: '0.875rem' }}>
              {note}
            </Box>
            <PrimaryAction
              label={t('proposals.sheet.send')}
              saving={saving}
              onClick={() => void submit()}
            />
            {proposal && (
              <Button
                color="error"
                disabled={saving}
                onClick={() => void withdraw()}
                sx={{ minHeight: 48, justifySelf: 'start' }}
              >
                {t('proposals.sheet.withdraw')}
              </Button>
            )}
          </>
        )}
      </EditorFooter>
    </EditorFrame>
  );
}

/** The dose of a medication of the baby's list, when it has one (a proposal starts from it). */
function defaultDoseOf(medications: readonly Medication[], id: string): Partial<PrescriptionForm> {
  const dose = medications.find((m) => m.id === id)?.defaultDosage;
  return dose ? { amount: dose.amount, unit: dose.unit } : {};
}

/** "Changes the current prescription: Give 2 ml, ...": what the proposal would replace. */
function ReplacesNote({ summary }: { summary: string }) {
  const { t } = useTranslation();
  return (
    <Box
      role="note"
      sx={(theme) => ({
        borderRadius: '18px',
        p: 1.5,
        backgroundColor: palette(theme).surfaceRaised,
        fontSize: '0.875rem',
      })}
    >
      {t('proposals.sheet.replaces', { summary })}
    </Box>
  );
}
