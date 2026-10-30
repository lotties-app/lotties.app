import { useTranslation } from 'react-i18next';
import { Alert, Card, Typography } from '@mui/material';
import { SwitchRow } from '../ui/form';
import { useServerAction } from '../settings/useServerAction';
import { DEFAULT_REST_SETTINGS, type RestSettings } from './restApi';
import { browserTimeZone } from './restModel';
import { useRestActions } from './useRest';

/**
 * The off-by-default opt-in: one switch and one sentence on what it is. Turning it on saves the
 * defaults with the browser's time zone; the Rest tab then appears.
 */
export function RestOptInCard({ settings }: { settings: RestSettings }) {
  const { t } = useTranslation();
  const { saveSettings } = useRestActions();
  const action = useServerAction();
  const turnOn = () =>
    action.run(() =>
      saveSettings({
        ...DEFAULT_REST_SETTINGS,
        ...settings,
        enabled: true,
        timeZone: browserTimeZone(),
      }),
    );
  return (
    <Card component="section" aria-labelledby="rest-optin-title" sx={{ p: 2.5 }}>
      <Typography id="rest-optin-title" variant="h6" component="h2">
        {t('rest.optIn.title')}
      </Typography>
      <SwitchRow
        checked={false}
        disabled={action.pending}
        onChange={() => void turnOn()}
        label={t('rest.optIn.switch')}
        description={t('rest.optIn.body')}
      />
      {action.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {action.error}
        </Alert>
      )}
    </Card>
  );
}
