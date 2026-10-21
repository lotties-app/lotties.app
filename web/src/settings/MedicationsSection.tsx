import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { canWrite } from '../baby/permissions';
import { useMedicationCommands, useMedications, usePrescriptionCommands } from '../db/hooks';
import type { Baby, Medication, Prescription } from '../db/models';
import { termsOf } from '../db/prescriptionCommands';
import { GuardrailNote } from '../medications/GuardrailNote';
import { LinkedProduct } from '../medications/LinkedProduct';
import { PrescriptionSheet } from '../medications/PrescriptionSheet';
import { amountWithUnit, summaryText } from '../medications/prescriptionForm';
import { stateLine } from '../medications/statusText';
import { useMedicationStatuses } from '../medications/useMedicationStatus';
import { Icon } from '../ui/Icon';
import { announceUndo } from '../ui/undoNotice';
import { MedicationDialog } from './MedicationDialog';

type Editing = { medication: Medication } | 'new' | null;
type EditingPrescription = { prescription: Prescription } | 'new' | null;

function dosageText(medication: Medication): string | null {
  const dose = medication.defaultDosage;
  return dose ? amountWithUnit(dose.amount, dose.unit) : null;
}

function MedicationRow({
  medication,
  writable,
  onEdit,
  onDelete,
  onToggleUsual,
}: {
  medication: Medication;
  writable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleUsual: (usual: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <ListItem
      divider
      secondaryAction={
        writable && (
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Switch
              checked={medication.isUsual}
              onChange={(_, on) => onToggleUsual(on)}
              slotProps={{
                input: {
                  'aria-label': t('medications.settings.usualNamed', { name: medication.name }),
                },
              }}
            />
            <IconButton
              aria-label={t('settings.medications.editNamed', { name: medication.name })}
              onClick={onEdit}
            >
              <Icon name="edit" />
            </IconButton>
            <IconButton
              aria-label={t('settings.medications.deleteNamed', { name: medication.name })}
              onClick={onDelete}
            >
              <Icon name="delete" />
            </IconButton>
          </Stack>
        )
      }
      sx={{ pr: writable ? 18 : 2 }}
    >
      <ListItemText
        primary={medication.name}
        secondary={
          <>
            {[dosageText(medication), medication.notes].filter(Boolean).join(' · ')}
            <Box component="span" sx={{ display: 'block' }}>
              <LinkedProduct medication={medication} />
            </Box>
          </>
        }
      />
    </ListItem>
  );
}

function PrescriptionRow({
  prescription,
  name,
  line,
  writable,
  onEdit,
}: {
  prescription: Prescription;
  name: string;
  line: string;
  writable: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ListItem
      divider
      sx={{ pr: writable ? 7 : 2 }}
      secondaryAction={
        writable && (
          <IconButton
            aria-label={t('medications.settings.editPrescriptionNamed', { name })}
            onClick={onEdit}
          >
            <Icon name="edit" />
          </IconButton>
        )
      }
    >
      <ListItemText
        primary={name}
        secondary={
          <>
            <Box component="span" sx={{ display: 'block' }}>
              {summaryText(termsOf(prescription))}
            </Box>
            <Box component="span" sx={{ display: 'block' }}>
              {line}
            </Box>
          </>
        }
      />
    </ListItem>
  );
}

function PrescriptionList({
  title,
  items,
  nameOf,
  lineOf,
  writable,
  onEdit,
}: {
  title: string;
  items: Prescription[];
  nameOf: (p: Prescription) => string;
  lineOf: (p: Prescription) => string;
  writable: boolean;
  onEdit: (p: Prescription) => void;
}) {
  if (items.length === 0) return null;
  return (
    <List aria-label={title} disablePadding>
      {items.map((p) => (
        <PrescriptionRow
          key={p.id}
          prescription={p}
          name={nameOf(p)}
          line={lineOf(p)}
          writable={writable}
          onEdit={() => onEdit(p)}
        />
      ))}
    </List>
  );
}

/**
 * Medications of the baby (with their shared-catalog product and a usual toggle) and the
 * prescriptions with the next-allowed state. Works offline: edits go through the local store and
 * the outbox. Deleting shows Undo instead of asking first.
 */
export function MedicationsSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const medications = useMedications(baby.id);
  const meds = useMedicationStatuses(baby.id);
  const commands = useMedicationCommands();
  const prescriptionCommands = usePrescriptionCommands();
  const writable = canWrite(baby);
  const [editing, setEditing] = useState<Editing>(null);
  const [editingRx, setEditingRx] = useState<EditingPrescription>(null);

  if (!medications || !meds) return null;
  const nameOf = (p: Prescription) =>
    medications.find((m) => m.id === p.medicationId)?.name ?? t('timeline.unknownMedication');
  const statusOf = (p: Prescription) => meds.statuses.find((s) => s.prescription.id === p.id);
  const lineOf = (p: Prescription) => {
    const status = statusOf(p);
    return status ? stateLine(status, meds.now).text : t('medications.settings.stoppedTitle');
  };
  const active = meds.prescriptions.filter((p) => p.status === 'active');
  const stopped = meds.prescriptions.filter((p) => p.status === 'stopped');

  const remove = async (medication: Medication) => {
    const deleted = await commands.remove(medication.id);
    if (!deleted) return;
    announceUndo(
      t('medications.settings.medicationDeleted', { name: medication.name }),
      async () => {
        const { name, defaultDosage, notes, isUsual, productId } = deleted.medication;
        const restored = await commands.create({
          babyId: baby.id,
          name,
          defaultDosage,
          notes,
          isUsual,
          productId,
        });
        await Promise.all(
          deleted.prescriptions.map((terms) =>
            prescriptionCommands.create(baby.id, { ...terms, medicationId: restored.id }),
          ),
        );
      },
    );
  };

  const toggleUsual = (medication: Medication, isUsual: boolean) =>
    void commands.update(medication.id, {
      name: medication.name,
      defaultDosage: medication.defaultDosage,
      notes: medication.notes,
      isUsual,
    });

  return (
    <Stack spacing={1.5}>
      <Stack spacing={1}>
        {medications.length === 0 && (
          <Typography color="text.secondary">{t('settings.medications.none')}</Typography>
        )}
        <List aria-label={t('settings.medications.list')} disablePadding>
          {medications.map((m) => (
            <MedicationRow
              key={m.id}
              medication={m}
              writable={writable}
              onEdit={() => setEditing({ medication: m })}
              onDelete={() => void remove(m)}
              onToggleUsual={(on) => toggleUsual(m, on)}
            />
          ))}
        </List>
        {writable ? (
          <Button
            startIcon={<Icon name="add" />}
            variant="outlined"
            onClick={() => setEditing('new')}
            sx={{ minHeight: 48, alignSelf: 'flex-start' }}
          >
            {t('settings.medications.add')}
          </Button>
        ) : (
          <Typography color="text.secondary">{t('settings.medications.viewOnly')}</Typography>
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle1" component="h3">
          {t('medications.settings.prescriptionsTitle')}
        </Typography>
        {meds.prescriptions.length === 0 && (
          <Typography color="text.secondary">
            {t('medications.settings.noPrescriptions')}
          </Typography>
        )}
        <PrescriptionList
          title={t('medications.settings.prescriptionsList')}
          items={active}
          nameOf={nameOf}
          lineOf={lineOf}
          writable={writable}
          onEdit={(prescription) => setEditingRx({ prescription })}
        />
        {stopped.length > 0 && (
          <>
            <Typography variant="subtitle2" component="h4" color="text.secondary">
              {t('medications.settings.stoppedTitle')}
            </Typography>
            <PrescriptionList
              title={t('medications.settings.stoppedList')}
              items={stopped}
              nameOf={nameOf}
              lineOf={() => t('medications.settings.stoppedTitle')}
              writable={writable}
              onEdit={(prescription) => setEditingRx({ prescription })}
            />
          </>
        )}
        {writable && (
          <Button
            startIcon={<Icon name="add" />}
            variant="outlined"
            onClick={() => setEditingRx('new')}
            sx={{ minHeight: 48, alignSelf: 'flex-start' }}
          >
            {t('medications.editor.titleNew')}
          </Button>
        )}
        <GuardrailNote />
      </Stack>

      {editing && (
        <MedicationDialog
          babyId={baby.id}
          medication={editing === 'new' ? undefined : editing.medication}
          onClose={() => setEditing(null)}
        />
      )}
      {editingRx && (
        <PrescriptionSheet
          babyId={baby.id}
          {...(editingRx === 'new' ? {} : { prescription: editingRx.prescription })}
          onDone={() => setEditingRx(null)}
        />
      )}
    </Stack>
  );
}
