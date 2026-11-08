import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Paper, Stack, Typography } from '@mui/material';
import { ConnectionStep } from './ConnectionStep';
import { ConsentStep } from './ConsentStep';
import {
  emptyConnectionForm,
  invalidFields,
  toSaveRequest,
  withoutPasswords,
} from './connectionForm';
import { ProviderStep } from './ProviderStep';
import {
  DEFAULT_APP_ROLE,
  DEFAULT_MIGRATOR_ROLE,
  generatePassword,
  rolesValid,
  type SetupRoles,
} from './setupSql';
import { SqlStep } from './SqlStep';
import { TestStep } from './TestStep';
import type { ProviderId } from './providers';
import { useSaveAndTest } from './useSaveAndTest';

const STEPS = ['provider', 'sql', 'connection', 'consent', 'test'] as const;
type Step = (typeof STEPS)[number];

/** What the server stores as the provider (shown back as "your Supabase database"), not translated. */
const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  supabase: 'Supabase',
  neon: 'Neon',
  other: 'Postgres',
};

const freshRoles = (): SetupRoles => ({
  appRole: DEFAULT_APP_ROLE,
  migratorRole: DEFAULT_MIGRATOR_ROLE,
  appPassword: generatePassword(),
  migratorPassword: generatePassword(),
});

/**
 * "Use my own database", step by step (docs/design/47-bring-your-own-database.md section 8.1):
 * provider, setup SQL, connection details, consent, then save and test. Everything stays in this
 * component's memory (never storage or the URL) and nothing is sent before "Save and test"; the
 * passwords are forgotten once the server saved them, and all of it when the wizard closes.
 */
export function SetupWizard({ babyId, onClose }: { babyId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<ProviderId>('supabase');
  const [roles, setRoles] = useState<SetupRoles>(freshRoles);
  const [form, setForm] = useState(() => emptyConnectionForm('supabase', roles));
  const [touched, setTouched] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const { phase, saveAndTest, test, reset } = useSaveAndTest(babyId, () => {
    setForm(withoutPasswords);
    setRoles((current) => ({ ...current, appPassword: '', migratorPassword: '' }));
  });

  const index = STEPS.indexOf(step);
  const invalid = invalidFields(form);
  const blocked =
    (step === 'sql' && !rolesValid(roles)) ||
    (step === 'connection' && invalid.length > 0) ||
    (step === 'consent' && !agreed);

  const chooseProvider = (next: ProviderId) => {
    setProvider(next);
    setForm(emptyConnectionForm(next, roles));
  };
  const changeRoles = (next: SetupRoles) => {
    setRoles(next);
    setForm((current) => ({
      ...current,
      appUsername: next.appRole,
      migratorUsername: next.migratorRole,
    }));
  };
  const next = () => {
    if (step === 'connection' && invalid.length > 0) return setTouched(true);
    if (!blocked) setStep(STEPS[index + 1]);
  };
  const editDetails = () => {
    reset();
    setTouched(false);
    setStep('connection');
  };

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, minWidth: 0 }}
      component="section"
      aria-labelledby="byo-wizard-title"
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            {t('byoDatabase.wizard.progress', { step: index + 1, total: STEPS.length })}
          </Typography>
          <Typography id="byo-wizard-title" variant="h6" component="h3">
            {t(`byoDatabase.wizard.steps.${step}`)}
          </Typography>
        </Stack>
        {step === 'provider' && <ProviderStep provider={provider} onChange={chooseProvider} />}
        {step === 'sql' && (
          <SqlStep
            roles={roles}
            onRoles={changeRoles}
            onRegenerate={() =>
              setRoles((current) => ({
                ...current,
                appPassword: generatePassword(),
                migratorPassword: generatePassword(),
              }))
            }
          />
        )}
        {step === 'connection' && (
          <ConnectionStep form={form} onChange={setForm} showErrors={touched} invalid={invalid} />
        )}
        {step === 'consent' && (
          <ConsentStep provider={PROVIDER_LABELS[provider]} agreed={agreed} onAgreed={setAgreed} />
        )}
        {step === 'test' && (
          <TestStep
            phase={phase}
            canSave={agreed && invalid.length === 0}
            onSave={() => void saveAndTest(toSaveRequest(form, PROVIDER_LABELS[provider]))}
            onRetest={() => void test()}
            onEdit={editDetails}
            onDone={onClose}
          />
        )}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {index > 0 && step !== 'test' && (
            <Button onClick={() => setStep(STEPS[index - 1])} sx={{ minHeight: 44 }}>
              {t('byoDatabase.wizard.back')}
            </Button>
          )}
          {step !== 'test' && (
            <Button
              variant="contained"
              onClick={next}
              disabled={step !== 'connection' && blocked}
              sx={{ minHeight: 44 }}
            >
              {t('byoDatabase.wizard.next')}
            </Button>
          )}
          {step === 'test' && phase.kind !== 'tested' && phase.kind !== 'testFailed' && (
            <Button
              onClick={() => setStep('consent')}
              disabled={phase.kind === 'busy'}
              sx={{ minHeight: 44 }}
            >
              {t('byoDatabase.wizard.back')}
            </Button>
          )}
          <Button
            color="inherit"
            onClick={onClose}
            disabled={phase.kind === 'busy'}
            sx={{ minHeight: 44 }}
          >
            {t('byoDatabase.wizard.cancel')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
