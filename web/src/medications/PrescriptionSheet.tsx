import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  Drawer,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import {
  useBodyWeight,
  useMedications,
  usePrescriptionCommands,
  usePrescriptions,
} from '../db/hooks';
import type { Medication, Prescription } from '../db/models';
import { termsOf } from '../db/prescriptionCommands';
import { Icon } from '../ui/Icon';
import { Field } from '../ui/form';
import { palette } from '../ui/form/styles';
import { announceUndo } from '../ui/undoNotice';
import { DoseFields } from './DoseFields';
import { GuardrailNote } from './GuardrailNote';
import { ExtraFields } from './ExtraFields';
import { MedicationChooser } from './MedicationChooser';
import { ScheduleFields } from './ScheduleFields';
import {
  emptyForm,
  formFromPrescription,
  lenientTerms,
  summaryText,
  toTerms,
  validateForm,
  type FormErrors,
  type PrescriptionForm,
} from './prescriptionForm';

export interface PrescriptionSheetProps {
  babyId: string;
  /** Edit this prescription; omit to add one. */
  prescription?: Prescription;
  /** Start a new prescription for this medication. */
  medicationId?: string;
  onDone: () => void;
}

function Frame({
  desktop,
  titleId,
  onClose,
  children,
}: {
  desktop: boolean;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (desktop) {
    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        aria-labelledby={titleId}
        slotProps={{
          paper: {
            sx: {
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 'min(760px, calc(100dvh - 64px))',
            },
          },
        }}
      >
        {children}
      </Dialog>
    );
  }
  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-labelledby': titleId,
          sx: {
            display: 'flex',
            flexDirection: 'column',
            height: 'auto',
            maxHeight: 'calc(100dvh - 16px)',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          },
        },
      }}
    >
      {children}
    </Drawer>
  );
}

/** The one-line plain-language rule at the top of the editor. */
function Summary({ text }: { text: string | null }) {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={(theme) => ({
        borderRadius: '18px',
        p: 1.75,
        backgroundColor: palette(theme).surfaceRaised,
        color: text ? palette(theme).text.primary : palette(theme).text.secondary,
      })}
    >
      <Box
        component="span"
        sx={{ display: 'block', fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}
      >
        {t('medications.editor.summaryLabel')}
      </Box>
      <Typography sx={{ fontWeight: text ? 600 : 400 }}>
        {text ?? t('medications.editor.summaryEmpty')}
      </Typography>
    </Box>
  );
}

/**
 * The prescription editor: what the doctor prescribed for one medication, as the parent entered
 * it. A live sentence at the top reads the rule back; the dose, the schedule (clock times, every N
 * hours, or as needed with a minimum interval and a daily maximum), a shared wait with other
 * medications, the course dates and notes follow. The doctor's prescription is the source for every
 * dose and interval the app shows; the footer says so. Mount only while open.
 */
export function PrescriptionSheet(props: PrescriptionSheetProps) {
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
}: PrescriptionSheetProps & { medications: Medication[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
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
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
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

  const edit = (patch: Partial<PrescriptionForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };
  const chooseMedication = (medication: Medication) =>
    edit({
      medicationId: medication.id,
      ...(form.amount === null && form.unit === '' && medication.defaultDosage
        ? { amount: medication.defaultDosage.amount, unit: medication.defaultDosage.unit }
        : {}),
    });

  const requestClose = () => {
    if (saving) return;
    if (dirty) setDiscarding(true);
    else onDone();
  };

  const submit = async () => {
    const found = validateForm(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) {
      setTimeout(
        () => bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        0,
      );
      return;
    }
    setSaving(true);
    try {
      const terms = toTerms(form, prescription?.status ?? 'active');
      if (prescription) await commands.update(prescription.id, terms);
      else await commands.create(babyId, terms);
      onDone();
    } catch (error) {
      setFailure(
        error instanceof Error ? describeApiError(error) : t('medications.editor.saveFailed'),
      );
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    if (!prescription) return;
    setSaving(true);
    try {
      await commands.setStatus(
        prescription.id,
        prescription.status === 'active' ? 'stopped' : 'active',
      );
      onDone();
    } catch (error) {
      setFailure(describeApiError(error));
      setSaving(false);
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

  return (
    <Frame desktop={desktop} titleId={titleId} onClose={requestClose}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, pt: 2, pb: 1 }}>
        <Typography id={titleId} variant="h5" component="h2" sx={{ flex: 1, minWidth: 0 }}>
          {editing ? t('medications.editor.titleEdit') : t('medications.editor.titleNew')}
        </Typography>
        <IconButton onClick={requestClose} aria-label={t('now.sheet.close')} edge="end">
          <Icon name="close" />
        </IconButton>
      </Box>
      <Box
        ref={bodyRef}
        sx={{
          flex: '1 1 auto',
          overflowY: 'auto',
          px: 2.5,
          pb: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          '& > *': { flexShrink: 0 },
        }}
      >
        <Summary text={summary} />
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
        <DoseFields form={form} errors={errors} weight={weight ?? null} onChange={edit} />
        <ScheduleFields form={form} errors={errors} onChange={edit} />
        <ExtraFields form={form} errors={errors} groups={groups} onChange={edit} />
      </Box>
      <Box
        sx={{
          flex: '0 0 auto',
          borderTop: 1,
          borderColor: 'divider',
          px: 2.5,
          pt: 1.5,
          pb: 'calc(16px + env(safe-area-inset-bottom))',
          display: 'grid',
          gap: 1.25,
        }}
      >
        <GuardrailNote />
        {discarding ? (
          <Box
            role="group"
            aria-label={t('events.sheet.discardQuestion')}
            sx={{ display: 'grid', gap: 1.5 }}
          >
            <Typography sx={{ fontWeight: 600 }}>{t('events.sheet.discardQuestion')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                autoFocus
                onClick={() => setDiscarding(false)}
                sx={{ flex: '1 1 140px', minHeight: 48, borderRadius: '999px' }}
              >
                {t('events.sheet.keepEditing')}
              </Button>
              <Button
                color="error"
                variant="outlined"
                onClick={onDone}
                sx={{ flex: '1 1 140px', minHeight: 48, borderRadius: '999px' }}
              >
                {t('events.sheet.discard')}
              </Button>
            </Box>
          </Box>
        ) : (
          <>
            <Box role="status" sx={{ color: 'error.main', fontSize: '0.875rem' }}>
              {note}
            </Box>
            <Button
              variant="contained"
              fullWidth
              onClick={() => void submit()}
              aria-busy={saving || undefined}
              startIcon={
                saving ? <CircularProgress size={20} color="inherit" aria-hidden /> : undefined
              }
              sx={{ minHeight: 56, borderRadius: '999px', fontSize: '1rem' }}
            >
              {t('common.save')}
            </Button>
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
      </Box>
    </Frame>
  );
}
