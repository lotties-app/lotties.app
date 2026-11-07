import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Link, Stack, Typography } from '@mui/material';
import { StartDemoError, startDemo } from '../auth/demo/startDemo';
import { useDemoEnabled } from '../auth/demo/useDemoEnabled';
import { useLocale } from '../i18n/useLocale';

/**
 * "Try the demo" (docs/design/45-try-it-demo.md): shown only when the server offers a demo. One
 * click starts a throwaway account; the sentence under the button is the consent for the demo.
 */
export function DemoTry() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const offer = useDemoEnabled();
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<StartDemoError['reason'] | null>(null);
  if (!offer) return null;

  const start = () => {
    setStarting(true);
    setFailure(null);
    startDemo(locale === 'pt-BR' ? 'pt-BR' : 'en').catch((error: unknown) => {
      setStarting(false);
      setFailure(error instanceof StartDemoError ? error.reason : 'unavailable');
    });
  };

  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-start', maxWidth: 520 }}>
      <Button variant="text" size="large" onClick={start} disabled={starting}>
        {starting ? t('demo.try.starting') : t('demo.try.button')}
      </Button>
      <Typography variant="body2" color="text.secondary">
        {t('demo.try.hint', { days: offer.lifetimeDays })}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        <Trans
          i18nKey="demo.try.consent"
          components={{
            terms: <Link component={RouterLink} to="/terms" />,
            privacy: <Link component={RouterLink} to="/privacy" />,
          }}
        />
      </Typography>
      {failure && (
        <Alert severity="warning" role="alert">
          {t(`demo.errors.${failure}`)}
        </Alert>
      )}
    </Stack>
  );
}
