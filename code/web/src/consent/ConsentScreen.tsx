import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { ApiError } from '../api/ApiError';
import { useDatabase } from '../db/DatabaseContext';
import { useBabies } from '../db/hooks';
import { countUnsyncedMutations } from '../db/outbox';
import { isDoctorOnly } from '../doctor/appMode';
import { useLocale } from '../i18n/useLocale';
import { policyFor } from '../legal/policyDocuments';
import { Rich } from '../legal/RichText';
import { slotsFor } from '../legal/richSlots';
import { DeleteAccountSection } from '../settings/DeleteAccountSection';
import { useSignOut } from '../session/useSignOut';
import { useOnline } from '../sync/useOnline';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { CONSENT_CAPACITIES, isConsentCapacity, type ConsentCapacity } from './consentApi';
import { useConsent } from './ConsentContext';

const POINTS = ['beta', 'data', 'risk', 'rights', 'controller'] as const;

/** Declining signs out: an explanation first, and the count of changes on this device that the sign-out would lose. */
function DeclineDialog({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const db = useDatabase();
  const { signOut } = useSignOut();
  const unsynced = useLiveQuery(() => countUnsyncedMutations(db), [db]) ?? 0;
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onClose={pending ? undefined : onBack} aria-labelledby="consent-decline-title">
      <DialogTitle id="consent-decline-title">{t('consent.declineDialog.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('consent.declineDialog.body')}</DialogContentText>
        {unsynced > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('consent.declineDialog.unsynced', { count: unsynced })}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onBack} disabled={pending}>
          {t('consent.declineDialog.back')}
        </Button>
        <Button
          color="error"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void signOut().catch(() => setPending(false));
          }}
        >
          {t('consent.declineDialog.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * The consent screen (docs/design/38-consent-and-terms.md section 3), shown instead of the app until the current version is
 * accepted: what Lotties keeps and what it does not do, the beta and the leak risk said plainly, the required declaration of who
 * she is (the child's parent or guardian, or an adult they authorised) and Accept / Decline. Declining signs out. A person who would
 * rather leave can download her data and delete her account from here.
 */
export function ConsentScreen() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const online = useOnline();
  const consent = useConsent();
  const policy = policyFor(locale);
  const slots = slotsFor(policy);
  const babies = useBabies();
  const [capacity, setCapacity] = useState<ConsentCapacity | ''>('');
  const [declared, setDeclared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<'failed' | 'outdated' | null>(null);
  const [declining, setDeclining] = useState(false);

  const ready = capacity !== '' && declared;
  const accept = async () => {
    if (capacity === '' || !declared) return;
    setSaving(true);
    setProblem(null);
    try {
      await consent.accept(capacity);
    } catch (error) {
      setProblem(
        error instanceof ApiError && error.code === 'consent_version_outdated'
          ? 'outdated'
          : 'failed',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        color: 'text.primary',
        display: 'flex',
        justifyContent: 'center',
        px: 2,
        py: { xs: 2, sm: 5 },
      }}
    >
      <Stack spacing={2} sx={{ width: '100%', maxWidth: 640 }} lang={locale}>
        <Paper
          component="main"
          variant="outlined"
          aria-labelledby="consent-title"
          sx={{ p: { xs: 2, sm: 3 }, borderRadius: `${RADIUS.card}px` }}
        >
          <Stack spacing={2}>
            <Typography variant="h4" component="h1" id="consent-title">
              {t('consent.title')}
            </Typography>
            <Typography>{t('consent.intro')}</Typography>
            <Box component="ul" sx={{ m: 0, pl: 3, '& li + li': { mt: 1 } }}>
              {POINTS.map((point) => (
                <Typography component="li" key={point}>
                  <strong>{t(`consent.points.${point}.lead`)}</strong>{' '}
                  <Rich text={t(`consent.points.${point}.text`)} slots={slots} />
                </Typography>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t('consent.calm')}
            </Typography>

            <FormControl>
              <FormLabel id="consent-capacity-label">{t('consent.capacity.legend')}</FormLabel>
              <RadioGroup
                aria-labelledby="consent-capacity-label"
                value={capacity}
                onChange={(event) =>
                  isConsentCapacity(event.target.value) && setCapacity(event.target.value)
                }
              >
                {CONSENT_CAPACITIES.map((choice) => (
                  <FormControlLabel
                    key={choice}
                    value={choice}
                    control={<Radio />}
                    label={t(`consent.capacity.${choice}`)}
                    sx={{ alignItems: 'flex-start', py: 0.5 }}
                  />
                ))}
              </RadioGroup>
            </FormControl>
            <FormControlLabel
              control={
                <Checkbox
                  required
                  checked={declared}
                  onChange={(event) => setDeclared(event.target.checked)}
                />
              }
              label={<Rich text={t('consent.declaration')} slots={slots} />}
              sx={{ alignItems: 'flex-start' }}
            />

            {!ready && (
              <Typography variant="body2" color="text.secondary">
                {t('consent.needBoth')}
              </Typography>
            )}
            {!online && <Alert severity="warning">{t('consent.offline')}</Alert>}
            {problem && (
              <Alert severity="error" role="alert">
                {t(problem === 'outdated' ? 'consent.outdated' : 'consent.failed')}
              </Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                variant="contained"
                size="large"
                disabled={!ready || saving || !online}
                onClick={() => void accept()}
                startIcon={
                  saving ? (
                    <CircularProgress size={18} aria-label={t('consent.saving')} />
                  ) : undefined
                }
                sx={{ minHeight: 52 }}
              >
                {t('consent.accept')}
              </Button>
              <Button
                variant="outlined"
                size="large"
                disabled={saving}
                onClick={() => setDeclining(true)}
                sx={{ minHeight: 52 }}
              >
                {t('consent.decline')}
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t('consent.declineNote')}
            </Typography>
          </Stack>
        </Paper>
        <Accordion
          disableGutters
          variant="outlined"
          slotProps={{ transition: { unmountOnExit: true } }}
        >
          <AccordionSummary
            expandIcon={<Icon name="expand" />}
            aria-controls="consent-leave-content"
            id="consent-leave-header"
          >
            <Stack>
              <Typography>{t('consent.leave.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('consent.leave.hint')}
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails id="consent-leave-content">
            <DeleteAccountSection variant={isDoctorOnly(babies) ? 'professional' : 'family'} />
          </AccordionDetails>
        </Accordion>
      </Stack>
      {declining && <DeclineDialog onBack={() => setDeclining(false)} />}
    </Box>
  );
}
