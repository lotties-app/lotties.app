import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { InvalidVaccinationError } from '../db/vaccinationCommands';
import type { Vaccination } from '../db/models';
import { currentLocale } from '../i18n/i18n';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import { DateField, Field, NotesRow, SegmentedControl, TextInput } from '../ui/form';
import { DoseChoices, type DoseChoice } from './DoseChoices';
import { VACCINATION_LIMITS, EARLIEST_GIVEN_ON, type VaccinationTerms } from './vaccinationModel';
import { dosesOfVaccine, nextPendingDoseId } from './vaccineModel';
import type { VaccineNetwork, VaccineSchedule } from './vaccineSchedule';
import type { DoseStatus } from './vaccineStatus';
import { doseLabelOf, vaccineName } from './vaccineText';
import { useVaccinationCommands } from './useVaccinations';
import { VaccineSelect } from './VaccineSelect';

/** The pick for a vaccine that is not in the schedule (the family types its name). */
const CUSTOM = '__custom__';
/** The pick for a dose the schedule does not list. */
const NO_DOSE = '__none__';

export interface RecordPreset {
  vaccineKey: string;
  doseId: string | null;
}

interface Props {
  babyId: string;
  /** `null`/`undefined`: the schedule is not on the device, so only "Other vaccine" can be recorded. */
  schedule: VaccineSchedule | null | undefined;
  /** The engine's states, to default to the next pending dose (empty without a birth date). */
  statuses: readonly DoseStatus[];
  /** The local calendar date `yyyy-mm-dd`: the latest date a vaccine can have been given. */
  today: string;
  /** Edit this record; omit to record a new vaccine. */
  record?: Vaccination;
  /** A vaccine and dose to start from (the "Record" button of a dose card). */
  preset?: RecordPreset;
  onClose: () => void;
  onSaved?: (record: Vaccination) => void;
}

interface FormState {
  vaccine: string;
  customName: string;
  dose: string;
  doseFree: string;
  givenOn: string;
  network: VaccineNetwork;
  networkTouched: boolean;
  clinic: string;
  lot: string;
  administeredBy: string;
  notes: string;
}

type FormError = 'vaccine' | 'customName' | 'givenOn' | 'givenOnFuture' | 'failed';

function initialState(props: Pick<Props, 'record' | 'preset' | 'schedule' | 'today'>): FormState {
  const { record, preset, schedule, today } = props;
  if (record) {
    const custom = record.vaccineKey === null;
    return {
      vaccine: custom ? CUSTOM : (record.vaccineKey ?? ''),
      customName: record.customName ?? '',
      dose: record.doseId ?? NO_DOSE,
      doseFree: record.doseId === null ? (record.doseLabel ?? '') : '',
      givenOn: record.givenOn,
      network: record.network,
      networkTouched: true,
      clinic: record.clinic ?? '',
      lot: record.lot ?? '',
      administeredBy: record.administeredBy ?? '',
      notes: record.notes ?? '',
    };
  }
  const dose = preset ? (preset.doseId ?? NO_DOSE) : NO_DOSE;
  const scheduled = schedule?.doses.find((d) => d.doseId === preset?.doseId);
  return {
    vaccine: preset?.vaccineKey ?? (schedule ? '' : CUSTOM),
    customName: '',
    dose,
    doseFree: '',
    givenOn: today,
    network: scheduled?.network ?? 'public',
    networkTouched: false,
    clinic: '',
    lot: '',
    administeredBy: '',
    notes: '',
  };
}

/**
 * Records a vaccine given to the baby, or edits a record: the vaccine (from the schedule or a name
 * typed in), the dose it satisfies (the next pending one by default, or "Not in the schedule"), the
 * date, where it was given and the optional clinic, lot, who gave it and notes. Saved on the device
 * and queued for sync.
 */
export function VaccinationSheet({
  babyId,
  schedule,
  statuses,
  today,
  record,
  preset,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const language = currentLocale();
  const commands = useVaccinationCommands();
  const [form, setForm] = useState<FormState>(() =>
    initialState({ record, preset, schedule, today }),
  );
  const [error, setError] = useState<FormError | null>(null);
  const [saving, setSaving] = useState(false);
  const change = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const custom = form.vaccine === CUSTOM;
  const doses =
    !custom && form.vaccine !== '' && schedule ? dosesOfVaccine(schedule, form.vaccine) : [];
  const chosenDose = doses.find((dose) => dose.doseId === form.dose);
  const recorded = new Set(
    statuses
      .filter((status) => status.state === 'given' && status.doseId !== record?.doseId)
      .map((status) => status.doseId),
  );

  const collator = new Intl.Collator(language);
  const vaccineOptions = [
    ...(schedule?.vaccines ?? [])
      .map((vaccine) => ({
        value: vaccine.key,
        label: vaccineName(schedule, vaccine.key, language),
      }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    { value: CUSTOM, label: t('vaccines.sheet.other') },
  ];
  // A record of a vaccine the schedule no longer lists keeps its place in the list.
  if (record?.vaccineKey && !vaccineOptions.some((option) => option.value === record.vaccineKey)) {
    vaccineOptions.unshift({
      value: record.vaccineKey,
      label: vaccineName(schedule, record.vaccineKey, language),
    });
  }

  const doseChoices: DoseChoice[] = [
    ...doses.map((dose) => ({
      value: dose.doseId,
      label: recorded.has(dose.doseId)
        ? t('vaccines.sheet.alreadyRecorded', { label: doseLabelOf(dose, language) })
        : doseLabelOf(dose, language),
    })),
    ...(record?.doseId && !doses.some((dose) => dose.doseId === record.doseId)
      ? [{ value: record.doseId, label: record.doseLabel ?? record.doseId }]
      : []),
    { value: NO_DOSE, label: t('vaccines.sheet.notInSchedule') },
  ];

  const chooseVaccine = (vaccine: string) => {
    const next =
      vaccine === CUSTOM || !schedule ? null : nextPendingDoseId(schedule, statuses, vaccine);
    const dose = next ? schedule?.doses.find((d) => d.doseId === next) : undefined;
    change({
      vaccine,
      dose: next ?? NO_DOSE,
      doseFree: '',
      ...(form.networkTouched || !dose ? {} : { network: dose.network }),
    });
  };

  const chooseDose = (dose: string) => {
    const scheduled = schedule?.doses.find((d) => d.doseId === dose);
    change({
      dose,
      ...(form.networkTouched || !scheduled ? {} : { network: scheduled.network }),
    });
  };

  const snapshotOf = (): string => {
    if (custom || form.dose === NO_DOSE) return form.doseFree;
    if (chosenDose) return doseLabelOf(chosenDose, language);
    return record?.doseId === form.dose ? (record.doseLabel ?? '') : '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.vaccine === '') return setError('vaccine');
    if (custom && !form.customName.trim()) return setError('customName');
    if (!form.givenOn || form.givenOn < EARLIEST_GIVEN_ON) return setError('givenOn');
    if (form.givenOn > today) return setError('givenOnFuture');
    const terms: VaccinationTerms = {
      vaccineKey: custom ? null : form.vaccine,
      doseId: custom || form.dose === NO_DOSE ? null : form.dose,
      customName: custom ? form.customName : null,
      doseLabel: snapshotOf(),
      givenOn: form.givenOn,
      network: form.network,
      clinic: form.clinic,
      lot: form.lot,
      administeredBy: form.administeredBy,
      notes: form.notes,
    };
    setSaving(true);
    try {
      const saved = record
        ? await commands.update(record.id, terms)
        : await commands.create(babyId, terms);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof InvalidVaccinationError ? asFormError(e) : 'failed');
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={record ? t('vaccines.sheet.editTitle') : t('vaccines.sheet.newTitle')}
      leading={<CategoryIcon name="vaccine" category="health" size={24} />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => void submit(e)}
        sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2.5 }}
      >
        <Field
          label={t('vaccines.sheet.vaccine')}
          required
          error={error === 'vaccine' ? t('vaccines.sheet.vaccineRequired') : undefined}
        >
          <VaccineSelect
            value={form.vaccine}
            onChange={chooseVaccine}
            options={vaccineOptions}
            placeholder={t('vaccines.sheet.vaccinePlaceholder')}
          />
        </Field>
        {custom && (
          <Field
            label={t('vaccines.sheet.customName')}
            required
            error={error === 'customName' ? t('vaccines.sheet.customNameRequired') : undefined}
          >
            <TextInput
              value={form.customName}
              onChange={(customName) => change({ customName })}
              maxLength={VACCINATION_LIMITS.customName}
            />
          </Field>
        )}
        {!custom && form.vaccine !== '' && (
          <Field label={t('vaccines.sheet.dose')} group>
            <DoseChoices value={form.dose} options={doseChoices} onChange={chooseDose} />
          </Field>
        )}
        {(custom || (form.vaccine !== '' && form.dose === NO_DOSE)) && (
          <Field label={t('vaccines.sheet.doseFree')} optional>
            <TextInput
              value={form.doseFree}
              onChange={(doseFree) => change({ doseFree })}
              maxLength={VACCINATION_LIMITS.doseLabel}
              placeholder={t('vaccines.sheet.doseFreePlaceholder')}
            />
          </Field>
        )}
        <Field
          label={t('vaccines.sheet.givenOn')}
          required
          group
          error={
            error === 'givenOn'
              ? t('vaccines.sheet.givenOnRequired')
              : error === 'givenOnFuture'
                ? t('vaccines.sheet.givenOnFuture')
                : undefined
          }
        >
          <DateField
            value={form.givenOn}
            onChange={(givenOn) => change({ givenOn })}
            min={EARLIEST_GIVEN_ON}
            max={today}
          />
        </Field>
        <Field label={t('vaccines.sheet.network')} group>
          <SegmentedControl<VaccineNetwork>
            value={form.network}
            onChange={(network) => network && change({ network, networkTouched: true })}
            options={[
              { value: 'public', label: t('vaccines.sheet.networks.public') },
              { value: 'private', label: t('vaccines.sheet.networks.private') },
            ]}
          />
        </Field>
        <Field label={t('vaccines.sheet.clinic')} optional icon="map-pin">
          <TextInput
            value={form.clinic}
            onChange={(clinic) => change({ clinic })}
            maxLength={VACCINATION_LIMITS.clinic}
          />
        </Field>
        <Field label={t('vaccines.sheet.lot')} optional>
          <TextInput
            value={form.lot}
            onChange={(lot) => change({ lot })}
            maxLength={VACCINATION_LIMITS.lot}
          />
        </Field>
        <Field label={t('vaccines.sheet.administeredBy')} optional icon="stethoscope">
          <TextInput
            value={form.administeredBy}
            onChange={(administeredBy) => change({ administeredBy })}
            maxLength={VACCINATION_LIMITS.administeredBy}
          />
        </Field>
        <Field label={t('vaccines.sheet.notes')} optional>
          <NotesRow
            value={form.notes}
            onChange={(notes) => change({ notes })}
            maxLength={VACCINATION_LIMITS.notes}
          />
        </Field>
        {error === 'failed' && (
          <Box role="alert" sx={{ fontSize: '0.875rem', color: 'error.main' }}>
            {t('vaccines.sheet.saveFailed')}
          </Box>
        )}
        <Button
          type="submit"
          variant="contained"
          disabled={saving}
          sx={{ minHeight: 52, borderRadius: '999px' }}
        >
          {t('common.save')}
        </Button>
      </Box>
    </SheetFrame>
  );
}

/** The field a rejected record points at; anything else is a failed save. */
function asFormError(error: InvalidVaccinationError): FormError {
  switch (error.code) {
    case 'vaccineKey':
    case 'doseId':
      return 'vaccine';
    case 'customName':
      return 'customName';
    case 'givenOn':
      return 'givenOn';
    default:
      return 'failed';
  }
}
