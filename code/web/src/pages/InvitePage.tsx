import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import { acceptInvite } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { useBabyActions } from '../baby/useBabyActions';
import { takePendingInvite } from '../invite/inviteToken';
import { ProfessionalProfileForm } from '../professional/ProfessionalProfileForm';

type InviteState =
  { kind: 'joining' } | { kind: 'needsProfile'; token: string } | { kind: 'failed'; error: string };

const needsProfessionalProfile = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 422 &&
  error.code === 'professional_profile_required';

/** The Doctor invite form: declare the professional profile, then the invite is accepted again. */
export function DeclareToJoin({ onDeclared }: { onDeclared: () => void }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2} sx={{ py: 4, maxWidth: 480, mx: 'auto' }}>
      <Typography variant="h5" component="h1">
        {t('doctor.inviteAccept.title')}
      </Typography>
      <Typography color="text.secondary">{t('doctor.inviteAccept.body')}</Typography>
      <ProfessionalProfileForm
        initial={null}
        onSaved={onDeclared}
        submitLabel={t('doctor.inviteAccept.saveAndJoin')}
      />
    </Stack>
  );
}

/**
 * `/invite` (signed in): joins the baby the parked invite token belongs to, then goes Home with it
 * selected. The token was parked by `InviteEntry` before any sign-in redirect. A Doctor invite
 * needs a professional profile first (422 `professional_profile_required`): the form is shown
 * here and the same invite is accepted once it is saved; the doctor then lands on her Patients.
 */
export function InvitePage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const { adopt } = useBabyActions();
  const navigate = useNavigate();
  const [state, setState] = useState<InviteState>({ kind: 'joining' });
  const started = useRef(false);

  const join = useCallback(
    (token: string | null) => {
      const request = token
        ? acceptInvite(api, token)
        : Promise.reject(new ApiError(404, { code: 'invite_not_found' }));
      request
        .then(async (baby) => {
          await adopt(baby);
          navigate(baby.role === 'Doctor' ? '/patients' : '/', { replace: true });
        })
        .catch((e: unknown) =>
          setState(
            token && needsProfessionalProfile(e)
              ? { kind: 'needsProfile', token }
              : { kind: 'failed', error: describeApiError(e) },
          ),
        );
    },
    [api, adopt, navigate],
  );

  useEffect(() => {
    // A token is single-use: guard against the double effect run in StrictMode.
    if (started.current) return;
    started.current = true;
    join(takePendingInvite());
  }, [join]);

  if (state.kind === 'needsProfile') {
    const { token } = state;
    return (
      <DeclareToJoin
        onDeclared={() => {
          setState({ kind: 'joining' });
          join(token);
        }}
      />
    );
  }
  if (state.kind === 'joining') {
    return (
      <Stack spacing={2} sx={{ alignItems: 'center', py: 6 }}>
        <CircularProgress aria-label={t('invite.joining')} />
        <Typography>{t('invite.joining')}</Typography>
      </Stack>
    );
  }
  return (
    <Stack spacing={2} sx={{ py: 4, maxWidth: 420, mx: 'auto' }}>
      <Typography variant="h5" component="h1">
        {t('invite.title')}
      </Typography>
      <Alert severity="error">{state.error}</Alert>
      <Button component={RouterLink} to="/" variant="contained" sx={{ minHeight: 48 }}>
        {t('invite.goHome')}
      </Button>
    </Stack>
  );
}
