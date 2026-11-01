import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, Typography } from '@mui/material';
import { useApiClient } from '../../api/ApiClientContext';
import { canWrite } from '../../baby/permissions';
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

/** What a member who never changed anything has (everything off). */
function defaultsFor(baby: Baby): BabyPreferencesDto {
  return {
    babyId: baby.id,
    canReceive: canWrite(baby),
    doseDue: false,
    doseLeadMinutes: 0,
    napWindow: false,
    napLeadMinutes: 10,
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
        {baby.name}
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
