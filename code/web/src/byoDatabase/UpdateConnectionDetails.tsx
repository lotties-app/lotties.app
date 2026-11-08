import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AlertTitle,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { ConnectionStep } from './ConnectionStep';
import {
  emptyConnectionForm,
  invalidFields,
  toSaveRequest,
  withoutPasswords,
} from './connectionForm';
import { PROVIDER_LABELS, providerOfLabel } from './providers';
import { DEFAULT_APP_ROLE, DEFAULT_MIGRATOR_ROLE } from './setupSql';
import { ResultAlert } from './TestStep';
import { resultMessageOf } from './storeMessages';
import { useSaveAndTest, type SavePhase } from './useSaveAndTest';

const DEFAULT_ROLES = { appRole: DEFAULT_APP_ROLE, migratorRole: DEFAULT_MIGRATOR_ROLE };

/** The last save or test: a confirmation when the new details work, else the problem. */
function UpdateOutcome({ phase }: { phase: SavePhase }) {
  const { t } = useTranslation();
  if (phase.kind === 'busy') return <CircularProgress aria-label={t('byoDatabase.test.busy')} />;
  if (phase.kind === 'saveFailed' || phase.kind === 'testFailed') {
    return <ResultAlert message={phase.message} />;
  }
  if (phase.kind !== 'tested') return null;
  if (!phase.result.ok) {
    return (
      <ResultAlert
        message={resultMessageOf(phase.result.result)}
        findings={phase.result.findings}
      />
    );
  }
  return (
    <Alert severity="success" role="status">
      <AlertTitle>{t('byoDatabase.update.done.title')}</AlertTitle>
      {t('byoDatabase.update.done.body')}
    </Alert>
  );
}

/**
 * "Update connection details" for a baby whose records are in the Owner's own database
 * (docs/design/47-bring-your-own-database.md section 8; docs/BYO-DATABASE.md troubleshooting): the
 * password was rotated, the provider reset it, or the pooler host changed. The same fields and
 * checks as the wizard's connection step; nothing is prefilled from the server (it never returns a
 * host, user or password), the passwords are typed again and forgotten once saved. Save replaces
 * the sealed details of the same store (the records and the baby's pointer do not change) and tests
 * them; Test tries the details already saved.
 */
export function UpdateConnectionDetails({
  babyId,
  providerLabel,
}: {
  babyId: string;
  providerLabel: string | null;
}) {
  const { t } = useTranslation();
  const provider = providerOfLabel(providerLabel);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => emptyConnectionForm(provider, DEFAULT_ROLES));
  const [touched, setTouched] = useState(false);
  const { phase, saveAndTest, test, reset } = useSaveAndTest(
    babyId,
    () => setForm(withoutPasswords),
    { grantConsent: false },
  );
  const invalid = invalidFields(form);
  const busy = phase.kind === 'busy';

  const save = () => {
    if (invalid.length > 0) return setTouched(true);
    void saveAndTest(toSaveRequest(form, providerLabel ?? PROVIDER_LABELS[provider]));
  };
  const close = () => {
    setOpen(false);
    setTouched(false);
    setForm(emptyConnectionForm(provider, DEFAULT_ROLES));
    reset();
  };

  if (!open) {
    return (
      <Button
        variant="outlined"
        onClick={() => setOpen(true)}
        sx={{ alignSelf: 'flex-start', minHeight: 44 }}
      >
        {t('byoDatabase.update.open')}
      </Button>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, minWidth: 0 }}
      component="section"
      aria-labelledby="byo-update-title"
    >
      <Stack spacing={2}>
        <Typography id="byo-update-title" variant="h6" component="h3">
          {t('byoDatabase.update.title')}
        </Typography>
        <Typography variant="body2">{t('byoDatabase.update.intro')}</Typography>
        <ConnectionStep form={form} onChange={setForm} showErrors={touched} invalid={invalid} />
        <UpdateOutcome phase={phase} />
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" disabled={busy} onClick={save} sx={{ minHeight: 44 }}>
            {t('byoDatabase.update.save')}
          </Button>
          <Button disabled={busy} onClick={() => void test()} sx={{ minHeight: 44 }}>
            {t('byoDatabase.update.test')}
          </Button>
          <Button color="inherit" disabled={busy} onClick={close} sx={{ minHeight: 44 }}>
            {t('byoDatabase.update.close')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
