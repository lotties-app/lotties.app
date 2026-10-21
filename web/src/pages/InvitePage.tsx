import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { acceptInvite } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { useBabyActions } from '../baby/useBabyActions';

/** `/invite/:token`: joins the baby the invite belongs to, then goes Home with it selected. */
export function InvitePage() {
  const { token = '' } = useParams();
  const api = useApiClient();
  const { adopt } = useBabyActions();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // A token is single-use: guard against the double effect run in StrictMode.
    if (started.current) return;
    started.current = true;
    acceptInvite(api, token)
      .then(async (baby) => {
        await adopt(baby);
        navigate('/', { replace: true });
      })
      .catch((e: unknown) => setError(describeApiError(e)));
  }, [api, token, adopt, navigate]);

  if (!error) {
    return (
      <Stack spacing={2} sx={{ alignItems: 'center', py: 6 }}>
        <CircularProgress aria-label="Joining" />
        <Typography>Joining…</Typography>
      </Stack>
    );
  }
  return (
    <Stack spacing={2} sx={{ py: 4, maxWidth: 420, mx: 'auto' }}>
      <Typography variant="h5" component="h1">
        Invite
      </Typography>
      <Alert severity="error">{error}</Alert>
      <Button component={RouterLink} to="/" variant="contained" sx={{ minHeight: 48 }}>
        Go to Home
      </Button>
    </Stack>
  );
}
