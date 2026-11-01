import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { siriBridge } from '../assistants/siriBridge';

interface Props {
  /** The MCP server URL the server reports. */
  url: string;
  /** The OIDC authority (Keycloak realm issuer) the Siri sign-in goes to. */
  authority: string;
}

type State = 'loading' | 'connected' | 'disconnected';

/**
 * Settings > Voice assistants > Siri and Shortcuts (docs/design/37-widgets-siri.md section 8): connects the iPhone's Siri
 * intents to the MCP server. Shown only in the iOS app, when the server has MCP on.
 */
export function SiriConnectPanel({ url, authority }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState((await siriBridge.status()) ? 'connected' : 'disconnected');
    } catch {
      setState('disconnected');
    }
  }, []);

  useEffect(() => {
    let live = true;
    siriBridge
      .status()
      .then((connected) => live && setState(connected ? 'connected' : 'disconnected'))
      .catch(() => live && setState('disconnected'));
    return () => {
      live = false;
    };
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <Stack spacing={1.5} component="section" aria-labelledby="siri-connect-title">
      <Typography variant="subtitle1" component="h3" id="siri-connect-title">
        {t('assistants.siri.title')}
      </Typography>
      <Typography color="text.secondary">{t('assistants.siri.intro')}</Typography>
      <Typography role="status" aria-live="polite">
        {state === 'connected'
          ? t('assistants.siri.connected')
          : state === 'disconnected'
            ? t('assistants.siri.notConnected')
            : ''}
      </Typography>
      {failed && <Alert severity="error">{t('assistants.siri.failed')}</Alert>}
      {state === 'connected' ? (
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() => void run(() => siriBridge.disconnect())}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t('assistants.siri.disconnect')}
        </Button>
      ) : (
        <Button
          variant="contained"
          disabled={busy || state === 'loading'}
          onClick={() => void run(() => siriBridge.connect(authority, url))}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t('assistants.siri.connect')}
        </Button>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('assistants.siri.needsInternet')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('assistants.siri.revoke')}
      </Typography>
    </Stack>
  );
}
