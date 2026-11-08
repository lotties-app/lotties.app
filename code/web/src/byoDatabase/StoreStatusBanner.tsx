import { useTranslation } from 'react-i18next';
import { Alert, AlertTitle, Typography } from '@mui/material';
import { formatDateTime } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import type { DataStoreStatus } from './dataStoreApi';
import { HEALTH_SEVERITY, storeHealthOf } from './storeMessages';

/**
 * How the family's own database is doing (docs/design/47-bring-your-own-database.md section 5): the
 * state in plain words and what to do next. Never a host, a user or the server's own text.
 */
export function StoreStatusBanner({ store }: { store: DataStoreStatus }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const health = storeHealthOf(store);
  return (
    <Alert severity={HEALTH_SEVERITY[health]} role="status">
      <AlertTitle>{t(`byoDatabase.health.${health}.title`)}</AlertTitle>
      <Typography variant="body2">{t(`byoDatabase.health.${health}.body`)}</Typography>
      {store.lastCheckedAt && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('byoDatabase.status.lastChecked', {
            date: formatDateTime(store.lastCheckedAt, locale),
          })}
        </Typography>
      )}
    </Alert>
  );
}
