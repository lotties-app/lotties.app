import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, Typography } from '@mui/material';
import { useApiClient } from '../../api/ApiClientContext';
import { canDecideProposals, canLog, canWrite } from '../../baby/permissions';
import type { Baby } from '../../db/models';
import { ErrorNotice } from '../../settings/ErrorNotice';
import { useServerAction } from '../../settings/useServerAction';
import { Field, SegmentedControl, SwitchRow } from '../../ui/form';
import {
  DOSE_LEADS,
  NAP_LEADS,
  putBabyPreferences,
  type BabyPreferencesDto,
  type DoseLead,
  type NapLead,
  type ReminderPreferences,
} from '../pushApi';
import { pushKeys } from '../usePush';
import { babyShownName } from '../../baby/shownName';

/** What a member who never changed anything has (everything off but the appointment reminders). */
function defaultsFor(baby: Baby): BabyPreferencesDto {
  const canReceive = canLog(baby);
  return {
    babyId: baby.id,
    canReceive,
    doseDue: false,
    doseLeadMinutes: 0,
    napWindow: false,
    napLeadMinutes: 10,
    bellyPainPattern: false,
    overtiredWarning: false,
    fussyPattern: false,
    diaperWetHeadsUp: false,
    diaperDirtyHeadsUp: false,
    appointmentReminders: canReceive,
    doctorSuggestions: false,
    vaccineReminders: false,
    cryDetected: false,
  };
}

function BabyRow({
  baby,
  prefs,
  online,
}: {
  baby: Baby;
  prefs: BabyPreferencesDto;
  online: boolean;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const save = useServerAction();
  const off = !prefs.canReceive || !online || save.pending;

  const update = (change: Partial<ReminderPreferences>) => {
    const next: ReminderPreferences = {
      doseDue: prefs.doseDue,
      doseLeadMinutes: prefs.doseLeadMinutes,
      napWindow: prefs.napWindow,
      napLeadMinutes: prefs.napLeadMinutes,
      bellyPainPattern: prefs.bellyPainPattern ?? false,
      overtiredWarning: prefs.overtiredWarning ?? false,
      fussyPattern: prefs.fussyPattern ?? false,
      diaperWetHeadsUp: prefs.diaperWetHeadsUp ?? false,
      diaperDirtyHeadsUp: prefs.diaperDirtyHeadsUp ?? false,
      appointmentReminders: prefs.appointmentReminders ?? prefs.canReceive,
      doctorSuggestions: prefs.doctorSuggestions ?? false,
      vaccineReminders: prefs.vaccineReminders ?? false,
      cryDetected: prefs.cryDetected ?? false,
      ...change,
    };
    const replace = (stored: BabyPreferencesDto) =>
      queryClient.setQueryData<BabyPreferencesDto[]>(pushKeys.preferences, (list) =>
        (list ?? []).some((p) => p.babyId === baby.id)
          ? (list ?? []).map((p) => (p.babyId === baby.id ? stored : p))
          : [...(list ?? []), stored],
      );
    const previous = prefs;
    replace({ ...prefs, ...next });
    void save.run(async () => {
      try {
        replace(await putBabyPreferences(api, baby.id, next));
      } catch (e) {
        replace(previous);
        throw e;
      }
    });
  };

  return (
    <Stack spacing={1} component="section" aria-labelledby={`push-baby-${baby.id}`}>
      <Typography variant="subtitle2" component="h4" id={`push-baby-${baby.id}`}>
        {babyShownName(baby)}
      </Typography>
      {!prefs.canReceive && (
        <Typography variant="body2" color="text.secondary">
          {t('notifications.reminders.viewerOnly')}
        </Typography>
      )}
      <SwitchRow
        icon="pill"
        checked={prefs.doseDue}
        disabled={off}
        onChange={(doseDue) => update({ doseDue })}
        label={t('notifications.reminders.dose')}
        description={t('notifications.reminders.doseHelp')}
      />
      {prefs.doseDue && (
        <Field label={t('notifications.reminders.lead')} group disabled={off}>
          <SegmentedControl<string>
            value={String(prefs.doseLeadMinutes)}
            onChange={(value) => value && update({ doseLeadMinutes: Number(value) as DoseLead })}
            options={DOSE_LEADS.map((lead) => ({
              value: String(lead),
              label: t(`notifications.reminders.doseLeads.${lead}`),
            }))}
          />
        </Field>
      )}
      <SwitchRow
        icon="zzz"
        checked={prefs.napWindow}
        disabled={off}
        onChange={(napWindow) => update({ napWindow })}
        label={t('notifications.reminders.nap')}
        description={t('notifications.reminders.napHelp')}
      />
      {prefs.napWindow && (
        <Field label={t('notifications.reminders.lead')} group disabled={off}>
          <SegmentedControl<string>
            value={String(prefs.napLeadMinutes)}
            onChange={(value) => value && update({ napLeadMinutes: Number(value) as NapLead })}
            options={NAP_LEADS.map((lead) => ({
              value: String(lead),
              label: t(`notifications.reminders.napLeads.${lead}`),
            }))}
          />
        </Field>
      )}
      <SwitchRow
        icon="massage"
        checked={prefs.bellyPainPattern ?? false}
        disabled={off}
        onChange={(bellyPainPattern) => update({ bellyPainPattern })}
        label={t('notifications.reminders.bellyPain')}
        description={t('notifications.reminders.bellyPainHelp')}
      />
      <SwitchRow
        icon="zzz"
        checked={prefs.overtiredWarning ?? false}
        disabled={off}
        onChange={(overtiredWarning) => update({ overtiredWarning })}
        label={t('notifications.reminders.overtired')}
        description={t('notifications.reminders.overtiredHelp')}
      />
      <SwitchRow
        icon="mood-cry"
        checked={prefs.fussyPattern ?? false}
        disabled={off}
        onChange={(fussyPattern) => update({ fussyPattern })}
        label={t('notifications.reminders.fussy')}
        description={t('notifications.reminders.fussyHelp')}
      />
      <SwitchRow
        icon="mood-cry"
        checked={prefs.cryDetected ?? false}
        disabled={off}
        onChange={(cryDetected) => update({ cryDetected })}
        label={t('notifications.reminders.cryDetected')}
      />
      <SwitchRow
        icon="diaper"
        checked={prefs.diaperWetHeadsUp ?? false}
        disabled={off}
        onChange={(diaperWetHeadsUp) => update({ diaperWetHeadsUp })}
        label={t('notifications.reminders.diaperWet')}
        description={t('notifications.reminders.diaperWetHelp')}
      />
      <SwitchRow
        icon="diaper"
        checked={prefs.diaperDirtyHeadsUp ?? false}
        disabled={off}
        onChange={(diaperDirtyHeadsUp) => update({ diaperDirtyHeadsUp })}
        label={t('notifications.reminders.diaperDirty')}
        description={t('notifications.reminders.diaperDirtyHelp')}
      />
      <SwitchRow
        icon="calendar"
        checked={prefs.appointmentReminders ?? prefs.canReceive}
        disabled={off}
        onChange={(appointmentReminders) => update({ appointmentReminders })}
        label={t('notifications.reminders.appointments')}
        description={t('notifications.reminders.appointmentsHelp')}
      />
      {canWrite(baby) && (
        <SwitchRow
          icon="vaccine"
          checked={prefs.vaccineReminders ?? false}
          disabled={off}
          onChange={(vaccineReminders) => update({ vaccineReminders })}
          label={t('notifications.reminders.vaccines')}
          description={t('notifications.reminders.vaccinesHelp')}
        />
      )}
      {canDecideProposals(baby) && (
        <SwitchRow
          icon="stethoscope"
          checked={prefs.doctorSuggestions ?? false}
          disabled={off}
          onChange={(doctorSuggestions) => update({ doctorSuggestions })}
          label={t('notifications.reminders.doctor')}
          description={t('notifications.reminders.doctorHelp')}
        />
      )}
      <ErrorNotice message={save.error} />
    </Stack>
  );
}

/** Per-baby kinds and lead times; Viewer rows are shown disabled. */
export function BabyReminders({
  babies,
  preferences,
  online,
}: {
  babies: readonly Baby[];
  preferences: readonly BabyPreferencesDto[];
  online: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" component="h3">
        {t('notifications.reminders.heading')}
      </Typography>
      {babies.map((baby) => (
        <BabyRow
          key={baby.id}
          baby={baby}
          prefs={preferences.find((p) => p.babyId === baby.id) ?? defaultsFor(baby)}
          online={online}
        />
      ))}
    </Stack>
  );
}
