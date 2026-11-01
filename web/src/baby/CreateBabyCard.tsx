import { Alert, Stack, Typography } from '@mui/material';
import { OFFLINE_MESSAGE } from '../api/errorMessages';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useServerAction } from '../settings/useServerAction';
import { BabyForm } from './BabyForm';
import { useBabyActions } from './useBabyActions';

/** Home empty state: create the first baby (needs a connection). */
export function CreateBabyCard() {
  const { create } = useBabyActions();
  const { run, pending, error, online } = useServerAction();

  return (
    <Stack spacing={2} sx={{ py: 4, maxWidth: 420, mx: 'auto' }}>
      <Typography variant="h6" component="h2" sx={{ textAlign: 'center' }}>
        No baby yet
      </Typography>
      <Typography color="text.secondary" sx={{ textAlign: 'center' }}>
        Create a baby to start logging, or open an invite link someone shared with you.
      </Typography>
      {!online && <Alert severity="warning">{OFFLINE_MESSAGE}</Alert>}
      <ErrorNotice message={error} />
      <BabyForm
        submitLabel="Create baby"
        disabled={!online}
        pending={pending}
        onSubmit={(request) => void run(() => create(request))}
      />
    </Stack>
  );
}
