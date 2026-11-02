import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { siriBridge, voiceKind, type VoiceKind } from '../assistants/siriBridge';

interface Props {
  /** The MCP server URL the server reports. */
  url: string;
  /** The OIDC authority (Keycloak realm issuer) the voice sign-in goes to. */
  authority: string;
  /** Siri (iOS) or Voice on Android; defaults to this app's platform. */
  kind?: VoiceKind;
}

type State = 'loading' | 'connected' | 'disconnected';

const TEXT = {
  siri: {
    title: 'assistants.siri.title',
    intro: 'assistants.siri.intro',
    connect: 'assistants.siri.connect',
    disconnect: 'assistants.siri.disconnect',
    connected: 'assistants.siri.connected',
    notConnected: 'assistants.siri.notConnected',
    failed: 'assistants.siri.failed',
    needsInternet: 'assistants.siri.needsInternet',
    revoke: 'assistants.siri.revoke',
  },
  android: {
    title: 'assistants.androidVoice.title',
    intro: 'assistants.androidVoice.intro',
    connect: 'assistants.androidVoice.connect',
    disconnect: 'assistants.androidVoice.disconnect',
    connected: 'assistants.androidVoice.connected',
    notConnected: 'assistants.androidVoice.notConnected',
    failed: 'assistants.androidVoice.failed',
    needsInternet: 'assistants.androidVoice.needsInternet',
    revoke: 'assistants.androidVoice.revoke',
  },
} as const;

/**
 * Settings > Voice assistants > Siri and Shortcuts (iOS, docs/design/37-widgets-siri.md section 8)
 * or Voice on Android (section 14): connects the phone's voice entry points to the MCP server.
 * Shown only in the native app, when the server has MCP on.
 */
export function SiriConnectPanel({ url, authority, kind = voiceKind() ?? 'siri' }: Props) {
  const { t } = useTranslation();
  const text = TEXT[kind];
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
        {t(text.title)}
      </Typography>
      <Typography color="text.secondary">{t(text.intro)}</Typography>
      <Typography role="status" aria-live="polite">
        {state === 'connected'
          ? t(text.connected)
          : state === 'disconnected'
            ? t(text.notConnected)
            : ''}
      </Typography>
      {failed && <Alert severity="error">{t(text.failed)}</Alert>}
      {state === 'connected' ? (
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() => void run(() => siriBridge.disconnect())}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t(text.disconnect)}
        </Button>
      ) : (
        <Button
          variant="contained"
          disabled={busy || state === 'loading'}
          onClick={() => void run(() => siriBridge.connect(authority, url))}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t(text.connect)}
        </Button>
      )}
      <Typography variant="body2" color="text.secondary">
        {t(text.needsInternet)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t(text.revoke)}
      </Typography>
    </Stack>
  );
}
