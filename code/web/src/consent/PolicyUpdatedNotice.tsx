import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Link } from '@mui/material';
import { formatDate } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import { CONSENT_VERSIONS } from '../legal/consentVersions';
import { useConsent } from './ConsentContext';

/**
 * "We updated the Privacy Policy and the Terms of Use on {date}" for a minor change (docs/design/38-consent-and-terms.md section 3,
 * closes gap G6): a dismissible notice with a link, shown in the app and the doctor's shell. Dismissing stores the version seen on
 * this device (per account). A material change shows the consent screen instead.
 */
export function PolicyUpdatedNotice() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { noticeVersion, dismissNotice } = useConsent();
  const entry = CONSENT_VERSIONS.find((candidate) => candidate.version === noticeVersion);
  if (!entry) return null;
  return (
    <Alert
      severity="info"
      role="status"
      sx={{ mx: 2, mt: 1, alignItems: 'center' }}
      action={
        <Button color="inherit" size="small" onClick={dismissNotice} sx={{ minHeight: 44 }}>
          {t('consent.banner.dismiss')}
        </Button>
      }
    >
      {t('consent.banner.text', { date: formatDate(entry.date, 'dayMonthYear', locale) })}{' '}
      <Link component={RouterLink} to="/privacy" onClick={dismissNotice}>
        {t('consent.banner.see')}
      </Link>
    </Alert>
  );
}
