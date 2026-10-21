import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { formatDate, formatNumber, formatUnit } from '../../i18n/format';
import { needsConfirmation, offeredAmount, prescriptionEntry } from '../../medications/doseEntry';
import { amountWithUnit, doseText, unitText } from '../../medications/prescriptionForm';
import { earlyWarning, stateLine, type StateTone } from '../../medications/statusText';
import { Field, NumberStepper } from '../../ui/form';
import { filledSurface, palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import type { MedicationEntry, TrayPrescription } from '../quickLog';

interface Props {
  item: TrayPrescription;
  now: Date;
  disabled: boolean;
  onLog: (entry: MedicationEntry) => void;
}

const TONE_ICON = { ok: 'check', wait: 'clock', due: 'warning', ended: 'info' } as const;

function StateText({ text, tone }: { text: string; tone: StateTone }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        fontSize: '0.8125rem',
        fontWeight: tone === 'due' ? 600 : 400,
        color: tone === 'due' ? palette(theme).warning.main : palette(theme).text.secondary,
      })}
    >
      <Icon name={TONE_ICON[tone]} size={16} />
      <span>{text}</span>
    </Box>
  );
}

/** The rule, the weight and the arithmetic behind a per-kg suggestion, so the parent can check it. */
function SuggestionInputs({ item }: { item: TrayPrescription }) {
  const { t } = useTranslation();
  const { status } = item;
  const dose = status.prescription.dose;
  const suggestion = status.suggestedDose;
  const rule = t('medications.confirm.rule', { rule: doseText(dose) });
  if (!suggestion) {
    return (
      <Box sx={{ display: 'grid', gap: 0.5, fontSize: '0.8125rem' }}>
        <span>{rule}</span>
        <span role="alert">{t('medications.confirm.noWeight')}</span>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 0.5, fontSize: '0.8125rem' }}>
      <span>{rule}</span>
      <span>
        {t('medications.confirm.weight', {
          weight: formatUnit(suggestion.kgUsed, 'kilogram'),
          date: formatDate(suggestion.weightDate, 'dayMonthYear'),
        })}
      </span>
      <span>
        {suggestion.roundingStep
          ? t('medications.confirm.calcRounded', {
              exact: formatNumber(suggestion.exactAmount),
              unit: unitText(suggestion.unit),
              step: formatNumber(suggestion.roundingStep),
              amount: formatNumber(suggestion.amount),
            })
          : t('medications.confirm.calc', {
              exact: formatNumber(suggestion.exactAmount),
              unit: unitText(suggestion.unit),
            })}
      </span>
      {suggestion.stale && (
        <span role="alert" style={{ fontWeight: 600 }}>
          {t('medications.confirm.stale', {
            date: formatDate(suggestion.weightDate, 'dayMonthYear'),
          })}
        </span>
      )}
    </Box>
  );
}

function Confirm({
  item,
  early,
  onLog,
  onCancel,
}: {
  item: TrayPrescription;
  early: string | null;
  onLog: (amount: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { status } = item;
  const [amount, setAmount] = useState<number | null>(offeredAmount(status));
  const perKg = status.prescription.dose.perKg;
  const unit = status.prescription.dose.unit;
  const step = unit.toLowerCase() === 'ml' ? 0.5 : 1;
  const label = early
    ? t('medications.confirm.logAnyway')
    : t('medications.confirm.log', { dose: amount ? amountWithUnit(amount, unit) : '' });
  return (
    <Box
      role="group"
      aria-label={t('medications.confirm.title', { name: item.medication.name })}
      sx={{ display: 'grid', gap: 1.5, pt: 1 }}
    >
      {early && (
        <Typography role="alert" sx={{ fontWeight: 600 }}>
          {early}
        </Typography>
      )}
      {perKg && <SuggestionInputs item={item} />}
      <Field label={t('medications.confirm.doseToGive', { unit: unitText(unit) })} required>
        <NumberStepper
          value={amount}
          onChange={setAmount}
          step={step}
          min={0}
          decimals={3}
          start={1}
        />
      </Field>
      {perKg && <Box sx={{ fontSize: '0.8125rem' }}>{t('medications.confirm.youConfirm')}</Box>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={amount === null || amount <= 0}
          onClick={() => amount && onLog(amount)}
          sx={{ flex: '1 1 160px', minHeight: 52, borderRadius: '999px' }}
        >
          {label}
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          onClick={onCancel}
          sx={{ flex: '1 1 120px', minHeight: 52, borderRadius: '999px' }}
        >
          {early ? t('medications.confirm.wait') : t('common.cancel')}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * One active prescription in the Meds tray: its dose, its state from the offline calculator and a
 * Log button. A fixed dose logs in one tap; a per-kg dose or a dose before the allowed time opens
 * a confirm step first (the inputs of the suggestion; "Too early: next allowed at 18:00. Log
 * anyway?"). Logging early is never blocked and is recorded as `override`.
 */
export function PrescriptionCard({ item, now, disabled, onLog }: Props) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const { status, medication } = item;
  const p = status.prescription;
  const line = stateLine(status, now);
  const warning = earlyWarning(status, now);
  const early = warning !== null;
  const offered = offeredAmount(status);
  const doseLine = p.dose.perKg
    ? offered !== null
      ? t('medications.tray.suggested', {
          dose: amountWithUnit(offered, p.dose.unit),
          rule: doseText(p.dose),
        })
      : t('medications.tray.perKgNoWeight', { rule: doseText(p.dose) })
    : doseText(p.dose);

  const log = (amount: number) => {
    setConfirming(false);
    onLog(prescriptionEntry(status, medication.name, amount, early));
  };
  const press = () => {
    if (needsConfirmation(status, early)) setConfirming(true);
    else if (offered !== null) log(offered);
  };

  return (
    <Box
      role="listitem"
      sx={(theme) => ({
        ...filledSurface(theme),
        borderRadius: '18px',
        p: 1.5,
        display: 'grid',
        gap: 0.75,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Icon name="pill" size={20} sx={{ color: 'text.secondary', flex: 'none' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {medication.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {[doseLine, p.indication].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        {!confirming && (
          <Button
            variant={early ? 'outlined' : 'contained'}
            disabled={disabled}
            onClick={press}
            aria-label={t('medications.tray.logNamed', { name: medication.name })}
            sx={{ minHeight: 48, minWidth: 80, borderRadius: '999px', flex: 'none' }}
          >
            {t('medications.tray.logOne')}
          </Button>
        )}
      </Box>
      <StateText text={line.text} tone={line.tone} />
      {confirming && (
        <Confirm
          item={item}
          early={warning?.text ?? null}
          onLog={log}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Box>
  );
}
