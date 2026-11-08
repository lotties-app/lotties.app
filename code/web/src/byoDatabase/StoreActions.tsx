import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Stack } from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import {
  dataStoreQueryKey,
  isNotImplemented,
  moveIntoDataStore,
  moveOutOfDataStore,
  removeDataStore,
} from './dataStoreApi';
import { OwnDatabaseHelpLink } from './OwnDatabaseHelpLink';
import { errorMessageOf, type ResultMessage } from './storeMessages';

type Outcome = { kind: 'comingSoon' } | { kind: 'failed'; message: ResultMessage } | null;

/** Runs one store action, and remembers whether the server cannot do it yet (501). */
function useStoreAction(babyId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const run = async (action: typeof moveIntoDataStore) => {
    setBusy(true);
    setOutcome(null);
    try {
      await action(api, babyId);
    } catch (error) {
      setOutcome(
        isNotImplemented(error)
          ? { kind: 'comingSoon' }
          : { kind: 'failed', message: errorMessageOf(error) },
      );
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: dataStoreQueryKey(babyId) });
  };
  return { busy, outcome, run };
}

function OutcomeNotice({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  if (!outcome) return null;
  if (outcome.kind === 'comingSoon') {
    return (
      <Alert severity="info" role="status">
        {t('byoDatabase.actions.comingSoon')}
      </Alert>
    );
  }
  return (
    <Alert severity="warning" role="status">
      {t(`byoDatabase.results.${outcome.message}.body`)}
      <Box>
        <OwnDatabaseHelpLink />
      </Box>
    </Alert>
  );
}

/**
 * The records are in the family's own database: "Back to Lotties hosting" moves them back. Until the
 * server can move records (API task T7) it answers 501 and the app says so; it never pretends.
 */
export function BackToHostedAction({ babyId }: { babyId: string }) {
  const { t } = useTranslation();
  const { busy, outcome, run } = useStoreAction(babyId);
  return (
    <Stack spacing={1}>
      {outcome?.kind !== 'comingSoon' && (
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() => void run(moveOutOfDataStore)}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t('byoDatabase.actions.backToHosted')}
        </Button>
      )}
      <OutcomeNotice outcome={outcome} />
    </Stack>
  );
}

/**
 * A database was saved but the records are still with Lotties: move them there (501 until the
 * server can), or forget the saved details.
 */
export function SavedStoreActions({ babyId, ready }: { babyId: string; ready: boolean }) {
  const { t } = useTranslation();
  const move = useStoreAction(babyId);
  const forget = useStoreAction(babyId);
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {ready && move.outcome?.kind !== 'comingSoon' && (
          <Button
            variant="contained"
            disabled={move.busy}
            onClick={() => void move.run(moveIntoDataStore)}
            sx={{ minHeight: 44 }}
          >
            {t('byoDatabase.actions.moveIn')}
          </Button>
        )}
        <Button
          color="inherit"
          disabled={forget.busy}
          onClick={() => void forget.run(removeDataStore)}
          sx={{ minHeight: 44 }}
        >
          {t('byoDatabase.actions.forget')}
        </Button>
      </Stack>
      <OutcomeNotice outcome={move.outcome} />
      <OutcomeNotice outcome={forget.outcome} />
    </Stack>
  );
}
