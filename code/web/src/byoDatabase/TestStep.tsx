import { useTranslation } from 'react-i18next';
import { Alert, AlertTitle, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { knownFindings, resultMessageOf, type ResultMessage } from './storeMessages';
import type { SavePhase } from './useSaveAndTest';

function ResultAlert({
  message,
  findings = [],
}: {
  message: ResultMessage;
  findings?: readonly string[];
}) {
  const { t } = useTranslation();
  const ok = message === 'ok';
  const known = knownFindings(findings);
  return (
    <Alert severity={ok ? 'success' : 'warning'} role="status">
      <AlertTitle>{t(`byoDatabase.results.${message}.title`)}</AlertTitle>
      {t(`byoDatabase.results.${message}.body`)}
      {known.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
          {known.map((finding) => (
            <li key={finding}>{t(`byoDatabase.findings.${finding}`)}</li>
          ))}
        </Box>
      )}
    </Alert>
  );
}

/**
 * Step 5: save the details and test them. Before the button nothing has left the browser; after
 * the save the passwords are forgotten here, so changing the details means typing them again.
 */
export function TestStep({
  phase,
  canSave,
  onSave,
  onRetest,
  onEdit,
  onDone,
}: {
  phase: SavePhase;
  canSave: boolean;
  onSave: () => void;
  onRetest: () => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const busy = phase.kind === 'busy';
  const saved = phase.kind === 'tested' || phase.kind === 'testFailed';
  const passed = phase.kind === 'tested' && phase.result.ok;
  return (
    <Stack spacing={2}>
      <Typography variant="body2">{t('byoDatabase.test.intro')}</Typography>
      {phase.kind === 'saveFailed' && <ResultAlert message={phase.message} />}
      {phase.kind === 'testFailed' && <ResultAlert message={phase.message} />}
      {phase.kind === 'tested' && (
        <ResultAlert
          message={resultMessageOf(phase.result.result)}
          findings={phase.result.findings}
        />
      )}
      {busy && <CircularProgress aria-label={t('byoDatabase.test.busy')} />}
      {saved && !passed && (
        <Typography variant="body2" color="text.secondary">
          {t('byoDatabase.test.passwordsForgotten')}
        </Typography>
      )}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {!saved && (
          <Button
            variant="contained"
            disabled={!canSave || busy}
            onClick={onSave}
            sx={{ minHeight: 44 }}
          >
            {t('byoDatabase.test.save')}
          </Button>
        )}
        {saved && !passed && (
          <>
            <Button variant="contained" disabled={busy} onClick={onRetest} sx={{ minHeight: 44 }}>
              {t('byoDatabase.test.retest')}
            </Button>
            <Button disabled={busy} onClick={onEdit} sx={{ minHeight: 44 }}>
              {t('byoDatabase.test.edit')}
            </Button>
          </>
        )}
        {passed && (
          <Button variant="contained" onClick={onDone} sx={{ minHeight: 44 }}>
            {t('byoDatabase.test.done')}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
