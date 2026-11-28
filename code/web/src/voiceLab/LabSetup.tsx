import { useTranslation } from 'react-i18next';
import { Alert, Checkbox, FormControlLabel, Stack } from '@mui/material';
import { SPEECH_ENGINES, type SpeechEngineKind } from '../platform/speechTypes';
import { Field, SegmentedControl } from '../ui/form';
import type { SpeechLocale } from '../voice/numberWords';
import { LAB_CONDITIONS, LAB_LOCALES, type LabCondition } from './labPhrases';
import { needsConfirmation, type VoiceLab } from './useVoiceLab';

/** Language, engine and condition of the run; the audio warning and its confirmation for server and web. */
export function LabSetup({ lab }: { lab: VoiceLab }) {
  const { t } = useTranslation();
  const { settings, change } = lab;
  const busy = lab.speaking !== null;
  return (
    <Stack spacing={2}>
      <Field label={t('voiceLab.setup.language')} group disabled={busy}>
        <SegmentedControl<SpeechLocale>
          value={settings.locale}
          options={LAB_LOCALES.map((value) => ({
            value,
            label: t(`voiceLab.setup.languages.${value}`),
          }))}
          onChange={(locale) => locale && change({ locale })}
        />
      </Field>
      <Field
        label={t('voiceLab.setup.engine')}
        group
        disabled={busy}
        help={t(`voiceLab.setup.engineHelp.${settings.engine}`)}
      >
        <SegmentedControl<SpeechEngineKind>
          value={settings.engine}
          options={SPEECH_ENGINES.map((value) => ({
            value,
            label: t(`voiceLab.setup.engines.${value}`),
          }))}
          onChange={(engine) => engine && change({ engine })}
        />
      </Field>
      {needsConfirmation(settings.engine) && (
        <Alert severity="warning">
          <Stack spacing={1}>
            <span>{t(`voiceLab.warning.${settings.engine === 'web' ? 'web' : 'server'}`)}</span>
            <FormControlLabel
              control={
                <Checkbox
                  checked={lab.confirmed}
                  onChange={(event) => lab.confirm(event.target.checked)}
                  disabled={busy}
                />
              }
              label={t(
                `voiceLab.warning.${settings.engine === 'web' ? 'confirmWeb' : 'confirmServer'}`,
              )}
            />
          </Stack>
        </Alert>
      )}
      <Field
        label={t('voiceLab.setup.condition')}
        group
        disabled={busy}
        help={t(`voiceLab.setup.conditionHelp.${settings.condition}`)}
      >
        <SegmentedControl<LabCondition>
          value={settings.condition}
          options={LAB_CONDITIONS.map((value) => ({
            value,
            label: t(`voiceLab.setup.conditions.${value}`),
          }))}
          onChange={(condition) => condition && change({ condition })}
        />
      </Field>
    </Stack>
  );
}
