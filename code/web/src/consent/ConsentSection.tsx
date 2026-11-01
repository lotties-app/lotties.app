import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { downloadAccountData } from '../account/exportAccountData';
import { downloadProfessionalData } from '../account/exportProfessionalData';
import { useApiClient } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import { formatDate } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useOnline } from '../sync/useOnline';
import {
  CONSENTS_QUERY_KEY,
  getConsents,
  OPTIONAL_CONSENT_KINDS,
  type ConsentState,
  type OptionalConsentKind,
} from './consentApi';

function OptionalState({ kind, state }: { kind: OptionalConsentKind; state: ConsentState | null }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  let text = t('consent.settings.optional.never');
  if (state?.accepted) {
    text = t('consent.settings.optional.on', {
      date: formatDate(state.acceptedAt, 'dayMonthYear', locale),
    });
  } else if (state?.withdrawnAt) {
    text = t('consent.settings.optional.off', {
      date: formatDate(state.withdrawnAt, 'dayMonthYear', locale),
    });
  }
  return (
    <ListItem disableGutters divider>
      <ListItemText
        primary={t(`consent.settings.optional.${kind}`)}
        secondary={text}
        slotProps={{ secondary: { component: 'span' } }}
      />
    </ListItem>
  );
}

/** Withdrawing the core consent: the explanation, then the export and the account deletion (the existing flow in Settings). */
function WithdrawDialog({ professional, onClose }: { professional: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const db = useDatabase();
  const api = useApiClient();
  const navigate = useNavigate();
  const [failed, setFailed] = useState<string | null>(null);

  const download = async () => {
    try {
      const done = professional
        ? await downloadProfessionalData(db, api)
        : await downloadAccountData(db);
      setFailed(done ? null : t('account.exportFailed'));
    } catch {
      setFailed(t(professional ? 'account.exportProfessionalFailed' : 'account.exportFailed'));
    }
  };

  return (
    <Dialog open onClose={onClose} aria-labelledby="consent-withdraw-title">
      <DialogTitle id="consent-withdraw-title">{t('consent.settings.withdraw.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('consent.settings.withdraw.body')}</DialogContentText>
        {failed && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {failed}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('consent.settings.withdraw.close')}</Button>
        <Button onClick={() => void download()}>{t('consent.settings.withdraw.export')}</Button>
        <Button
          color="error"
          onClick={() =>
            void navigate({
              pathname: professional ? '/doctor/settings' : '/settings',
              hash: '#account',
            })
          }
        >
          {t('consent.settings.withdraw.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Settings > Privacy and data (docs/design/38-consent-and-terms.md section 5): what the person accepted (version, date, who she
 * declared to be), links to the terms and the policy, the optional consents with their state, and how to withdraw. The core consent
 * is withdrawn by exporting and deleting the account (the existing flow below it); optional ones by turning the feature off.
 */
export function ConsentSection({ variant = 'family' }: { variant?: 'family' | 'professional' }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const online = useOnline();
  const [withdrawing, setWithdrawing] = useState(false);
  const consents = useQuery({
    queryKey: CONSENTS_QUERY_KEY,
    queryFn: () => getConsents(api),
    enabled: online,
    gcTime: 0,
  });

  if (!online && consents.data === undefined) {
    return <Alert severity="warning">{t('consent.settings.offline')}</Alert>;
  }
  if (consents.isError) return <ErrorNotice message={t('consent.settings.loadFailed')} />;
  if (consents.data === undefined) return <CircularProgress aria-label={t('common.loading')} />;

  const { core, optional } = consents.data;
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('consent.settings.intro')}
      </Typography>
      <Stack spacing={0.5}>
        <Typography variant="subtitle1" component="h3">
          {t('consent.settings.core.title')}
        </Typography>
        <Typography>
          {core
            ? t('consent.settings.core.accepted', {
                version: core.version,
                date: formatDate(core.acceptedAt, 'dayMonthYear', locale),
                capacity: t(
                  core.capacity === 'guardian'
                    ? 'consent.settings.core.asGuardian'
                    : 'consent.settings.core.asAuthorised',
                ),
              })
            : t('consent.settings.core.none')}
        </Typography>
        <Link component={RouterLink} to="/terms" sx={{ alignSelf: 'flex-start', py: 0.75 }}>
          {t('consent.settings.core.terms')}
        </Link>
        <Link component={RouterLink} to="/privacy" sx={{ alignSelf: 'flex-start', py: 0.75 }}>
          {t('consent.settings.core.privacy')}
        </Link>
      </Stack>
      <Stack spacing={0.5}>
        <Typography variant="subtitle1" component="h3">
          {t('consent.settings.optional.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('consent.settings.optional.intro')}
        </Typography>
        <List disablePadding>
          {OPTIONAL_CONSENT_KINDS.map((kind) => (
            <OptionalState key={kind} kind={kind} state={optional[kind]} />
          ))}
        </List>
      </Stack>
      <Button
        variant="outlined"
        color="error"
        onClick={() => setWithdrawing(true)}
        sx={{ alignSelf: 'flex-start', minHeight: 44 }}
      >
        {t('consent.settings.withdraw.button')}
      </Button>
      {withdrawing && (
        <WithdrawDialog
          professional={variant === 'professional'}
          onClose={() => setWithdrawing(false)}
        />
      )}
    </Stack>
  );
}
