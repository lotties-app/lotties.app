import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { canWrite } from '../baby/permissions';
import { useMedicationCommands, useMedications } from '../db/hooks';
import type { Baby, Medication } from '../db/models';
import { t } from '../i18n/i18n';
import { formatNumber } from '../i18n/format';
import { ConfirmDialog } from './ConfirmDialog';
import { MedicationDialog } from './MedicationDialog';
import { Icon } from '../ui/Icon';

type Editing = { medication: Medication } | 'new' | null;

function dosageText(medication: Medication): string | null {
  const dose = medication.defaultDosage;
  return dose
    ? t('settings.medications.dose', { amount: formatNumber(dose.amount), unit: dose.unit })
    : null;
}

function MedicationRow({
  medication,
  writable,
  onEdit,
  onDelete,
}: {
  medication: Medication;
  writable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ListItem
      divider
      secondaryAction={
        writable && (
          <Stack direction="row">
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
    >
      <ListItemText
        primary={
          <>
            {medication.name}
            {medication.isUsual && <Chip size="small" label={t('events.usual')} sx={{ ml: 1 }} />}
          </>
        }
        secondary={[dosageText(medication), medication.notes].filter(Boolean).join(' · ')}
      />
    </ListItem>
  );
}

/** Medication catalog. Works offline: edits go through the local store and the outbox. */
export function MedicationsSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const medications = useMedications(baby.id);
  const commands = useMedicationCommands();
  const writable = canWrite(baby);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Medication | null>(null);

  if (!medications) return null;

  return (
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
            onDelete={() => setDeleting(m)}
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
      {editing && (
        <MedicationDialog
          babyId={baby.id}
          medication={editing === 'new' ? undefined : editing.medication}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('settings.medications.deleteTitle', { name: deleting.name })}
          body={t('settings.medications.deleteBody')}
          confirmLabel={t('settings.medications.deleteConfirm')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void commands.remove(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Stack>
  );
}
