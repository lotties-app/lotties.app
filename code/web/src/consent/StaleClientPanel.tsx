import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import { ExternalLink } from '../credits/ExternalLink';
import { phoneAppLinks } from '../landing/phoneAppLinks';
import { isNativeApp, nativePlatform } from '../platform/nativeApp';
import { attemptStaleReload, staleReloadTried } from './staleClient';

type Phase = 'updating' | 'panel';

/** What to do, per runtime: the store app is updated from its store, a browser by reopening it. */
function UpdateSteps() {
  const { t } = useTranslation();
  if (!isNativeApp()) {
    return (
      <>
        <Typography>{t('consent.stale.web.reopen')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('consent.stale.web.clearData')}
        </Typography>
      </>
    );
  }
  const platform = nativePlatform();
  // Only the Play listing has a store address today (VITE_PLAY_STORE_URL); without one the text says where to go.
  const playStore = platform === 'android' ? phoneAppLinks().playStore : null;
  return (
    <>
      <Typography>{t(`consent.stale.native.${platform ?? 'other'}`)}</Typography>
      {playStore && (
        <Box>
          <ExternalLink href={playStore}>{t('consent.stale.native.openPlayStore')}</ExternalLink>
        </Box>
      )}
    </>
  );
}

/**
 * Shown by the consent screen instead of the Accept form when the server asks for a consent version this build does not carry
 * (docs/design/38-consent-and-terms.md section 10). Accepting would record a text she never saw, so there is no Accept here.
 * In a browser the first time in a session it fetches the latest bundle and reloads once (`staleClient.ts`); if the reloaded
 * page is still old, or in the store app, it says how to update.
 */
export function StaleClientPanel({ focusOnShow }: { focusOnShow: boolean }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(() =>
    isNativeApp() || staleReloadTried() ? 'panel' : 'updating',
  );
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase !== 'updating' || started.current) return;
    started.current = true;
    void attemptStaleReload().then((reloading) => {
      if (!reloading) setPhase('panel');
    });
  }, [phase]);

  useEffect(() => {
    if (focusOnShow && phase === 'panel') heading.current?.focus();
  }, [focusOnShow, phase]);

  if (phase === 'updating') {
    return (
      <Stack spacing={2} sx={{ py: 3, alignItems: 'center' }} role="status">
        <CircularProgress aria-hidden="true" />
        <Typography component="h1" id="consent-title">
          {t('consent.stale.updating')}
        </Typography>
      </Stack>
    );
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" id="consent-title" tabIndex={-1} ref={heading}>
        {t('consent.stale.title')}
      </Typography>
      <Alert severity="warning" role="status">
        {t('consent.stale.body')}
      </Alert>
      <UpdateSteps />
    </Stack>
  );
}
