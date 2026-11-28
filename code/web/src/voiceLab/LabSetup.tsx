import { useTranslation } from 'react-i18next';
import { Stack } from '@mui/material';
import { Field, SegmentedControl } from '../ui/form';
import type { SpeechLocale } from '../voice/numberWords';
import { LAB_CONDITIONS, LAB_LOCALES, type LabCondition } from './labPhrases';
import type { VoiceLab } from './useVoiceLab';

/**
 * The language spoken (both modes). There is no engine choice: speech is recognised on the phone only
 * (server and Web recognition were left out on purpose, docs/design/49a-voice-lab.md).
 */
export function LanguageField({ lab }: { lab: VoiceLab }) {
  const { t } = useTranslation();
  return (
    <Field
      label={t('voiceLab.setup.language')}
      group
      disabled={lab.speaking !== null}
      help={t('voiceLab.setup.onDeviceOnly')}
    >
      <SegmentedControl<SpeechLocale>
        value={lab.settings.locale}
        options={LAB_LOCALES.map((value) => ({
          value,
          label: t(`voiceLab.setup.languages.${value}`),
        }))}
        onChange={(locale) => locale && lab.change({ locale })}
      />
    </Field>
  );
}

/** Language and condition of a guided run. */
export function LabSetup({ lab }: { lab: VoiceLab }) {
  const { t } = useTranslation();
  const { settings, change } = lab;
  return (
    <Stack spacing={2}>
      <LanguageField lab={lab} />
      <Field
        label={t('voiceLab.setup.condition')}
        group
        disabled={lab.speaking !== null}
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
