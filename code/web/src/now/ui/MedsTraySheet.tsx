import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import type { Prescription } from '../../db/models';
import { formatList } from '../../i18n/format';
import { Illustration } from '../../ui/illustrations';
import { ChipGroup } from '../../ui/form';
import { GuardrailNote } from '../../medications/GuardrailNote';
import { reminderSlotAt } from '../../notifications/doseReminder';
import { DoseReminderLine } from '../../notifications/ui/DoseReminderLine';
import { Icon } from '../../ui/Icon';
import { medicationPayloadEntries, type MedicationEntry, type MedsTray } from '../quickLog';
import { PrescriptionCard } from './PrescriptionCard';
import { SheetFrame } from './SheetFrame';

interface Props {
  open: boolean;
  onClose: () => void;
  tray: MedsTray;
  /** The clock the prescriptions' states are read at. */
  now: Date;
  disabled: boolean;
  onChoose: (medications: MedicationEntry[]) => void;
  /** Opens the prescription editor (hidden when omitted). */
  onAddPrescription?: () => void;
  /** The Doctor proposes a change to a prescription a doctor suggested (hidden when omitted). */
  onProposeChange?: (prescription: Prescription) => void;
  /** Opened from a dose reminder: the line goes on that prescription's card. */
  reminder?: TrayReminder;
}

/** The validated ids of the notification that opened the tray. */
export interface TrayReminder {
  rxId: string;
  deliveryId: string;
  token?: string;
}

/**
 * The Meds tray: each active prescription with its state (available at, due now, doses today) and
 * a Log button that prefills the prescribed dose; then the other medications as chips (multi-select)
 * and "Same as last time". The doctor's prescription is the only source of doses and intervals.
 */
export function MedsTraySheet({
  open,
  onClose,
  tray,
  now,
  disabled,
  onChoose,
  onAddPrescription,
  onProposeChange,
  reminder,
}: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const all = [...tray.usual, ...tray.others];
  const prescribed = tray.prescriptions.length > 0;

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title={t('now.medsTray.title')}
      leading={<Illustration name="medication" size={48} />}
    >
      {prescribed && (
        <>
          <Typography variant="overline" component="p" color="text.secondary">
            {t('medications.tray.prescriptions')}
          </Typography>
          <Box
            role="list"
            aria-label={t('medications.tray.prescriptions')}
            sx={{ display: 'grid', gap: 1 }}
          >
            {tray.prescriptions.map((item) => {
              const slotAt =
                reminder?.rxId === item.status.prescription.id
                  ? reminderSlotAt(item.status, now)
                  : null;
              return (
                <PrescriptionCard
                  key={item.status.prescription.id}
                  item={item}
                  now={now}
                  disabled={disabled}
                  onLog={(entry) => onChoose([entry])}
                  {...(onProposeChange
                    ? { onProposeChange: () => onProposeChange(item.status.prescription) }
                    : {})}
                >
                  {reminder && slotAt && (
                    <DoseReminderLine
                      slotAt={slotAt}
                      deliveryId={reminder.deliveryId}
                      {...(reminder.token !== undefined ? { token: reminder.token } : {})}
                    />
                  )}
                </PrescriptionCard>
              );
            })}
          </Box>
        </>
      )}
      {tray.same && (
        <Button
          variant="outlined"
          color="inherit"
          fullWidth
          disabled={disabled}
          onClick={() => onChoose(tray.same?.medications ?? [])}
          sx={{ minHeight: 56, justifyContent: 'flex-start' }}
        >
          {t('now.medsTray.same', {
            names: formatList(tray.same.medications.map((m) => m.name)),
          })}
        </Button>
      )}
      {all.length === 0 && !prescribed ? (
        <Typography color="text.secondary">
          {t('now.medsTray.none')}{' '}
          <Link to="/hub/medicines" onClick={onClose}>
            {t('now.medsTray.open')}
          </Link>
        </Typography>
      ) : (
        all.length > 0 && (
          <>
            <Typography variant="overline" component="p" color="text.secondary">
              {prescribed ? t('medications.tray.others') : t('now.medsTray.choose')}
            </Typography>
            <ChipGroup
              multiple
              aria-label={t('now.medsTray.choose')}
              value={selected}
              onChange={setSelected}
              options={all.map((m) => ({ value: m.id, label: m.name }))}
            />
            <Button
              variant="contained"
              size="large"
              fullWidth
              disabled={disabled || selected.length === 0}
              onClick={() => onChoose(medicationPayloadEntries(selected, all))}
              sx={{ minHeight: 56 }}
            >
              {selected.length === 0
                ? t('now.medsTray.pick')
                : t('now.medsTray.log', { count: selected.length })}
            </Button>
          </>
        )
      )}
      {onAddPrescription && !disabled && (
        <Button
          startIcon={<Icon name="add" size={20} />}
          onClick={onAddPrescription}
          sx={{ minHeight: 48, alignSelf: 'flex-start' }}
        >
          {t('medications.tray.addPrescription')}
        </Button>
      )}
      <GuardrailNote />
    </SheetFrame>
  );
}
