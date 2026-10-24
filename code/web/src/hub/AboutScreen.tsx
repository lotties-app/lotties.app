import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Link, Paper, Stack, Typography } from '@mui/material';
import { readBuildInfo } from '../config/buildInfo';
import { useServerVersion } from '../config/serverVersion';
import {
  displayVersion,
  serverIsNewer,
  shortCommit,
  type VersionStamp,
} from '../config/versionInfo';
import { formatDateTime } from '../i18n/format';
import { repoUrl } from '../landing/repoUrl';
import { isNativeApp } from '../platform/nativeApp';
import { applyUpdate, checkForUpdates, useUpdateSnapshot } from '../pwa/updateStore';
import { RADIUS } from '../theme/tokens';
import { copyText } from '../util/copyText';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography variant="caption" color="text.secondary" component="dt">
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </div>
  );
}

/** "v0.1.38 · commit abc1234 · built 24 Oct 2026, 10:00": the parts that are known. */
function useStampText() {
  const { t } = useTranslation();
  return (stamp: VersionStamp) =>
    [
      displayVersion(stamp.version),
      stamp.commit && t('hub.about.commitValue', { commit: shortCommit(stamp.commit) }),
      stamp.builtAt && t('hub.about.builtValue', { date: formatDateTime(stamp.builtAt) }),
    ]
      .filter(Boolean)
      .join(' · ');
}

/** "v0.1.38 (commit abc1234)" for the copied report. */
function reportPart(stamp: VersionStamp): string {
  const version = displayVersion(stamp.version);
  return stamp.commit ? `${version} (commit ${shortCommit(stamp.commit)})` : version;
}

/**
 * The server runs a newer release: offer the existing update flow (Hub > Check for updates). In the
 * native app the store updates it. The check may also find nothing when only the API changed.
 */
function UpdateHint({ server }: { server: string }) {
  const { t } = useTranslation();
  const { state } = useUpdateSnapshot();
  const native = isNativeApp();
  return (
    <Alert severity="info">
      <Typography sx={{ fontWeight: 600 }}>
        {t('hub.about.updateHint', { version: displayVersion(server) })}
      </Typography>
      {native && <Typography variant="body2">{t('hub.updates.unsupportedNative')}</Typography>}
      {state === 'upToDate' && <Typography variant="body2">{t('hub.updates.upToDate')}</Typography>}
      {state === 'error' && <Typography variant="body2">{t('hub.updates.error')}</Typography>}
      {/* Ready (a waiting worker), or a browser without a service worker: a reload is the update. */}
      {(state === 'ready' || (state === 'unsupported' && !native)) && (
        <Button
          variant="contained"
          onClick={() => void applyUpdate()}
          sx={{ mt: 1, minHeight: 44 }}
        >
          {t('hub.updates.reload')}
        </Button>
      )}
      {(state === 'idle' || state === 'checking' || state === 'error') && (
        <Button
          variant="outlined"
          disabled={state === 'checking'}
          onClick={() => void checkForUpdates()}
          sx={{ mt: 1, minHeight: 44 }}
        >
          {state === 'checking' ? t('hub.updates.checking') : t('hub.updates.check')}
        </Button>
      )}
    </Alert>
  );
}

const SERVER_STATUS_KEY = {
  loading: 'hub.about.serverLoading',
  unavailable: 'hub.about.serverUnavailable',
} as const;

/**
 * Hub > About: what this device runs and what the server runs (release, commit, build time, stamped
 * by the deploy), a hint when the server is newer, a "Copy version info" button for bug reports,
 * and the licence. The server's version loads after the screen, with a short timeout.
 */
export function AboutScreen({ basePath = '/hub' }: { basePath?: string }) {
  const { t } = useTranslation();
  const app = readBuildInfo();
  const server = useServerVersion();
  const stampText = useStampText();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const source = repoUrl();

  const serverValue =
    server.status === 'ok' ? stampText(server.stamp) : t(SERVER_STATUS_KEY[server.status]);
  const report = t('hub.about.report', {
    app: reportPart(app),
    server: server.status === 'ok' ? reportPart(server.stamp) : t('hub.about.serverUnavailable'),
  });
  const copy = async () => setCopied((await copyText(report)) ? 'yes' : 'failed');

  return (
    <Paper sx={{ p: 2.5, borderRadius: `${RADIUS.card}px` }}>
      <Stack spacing={2}>
        <Typography color="text.secondary">{t('hub.about.tagline')}</Typography>
        <Stack component="dl" spacing={1.5} sx={{ m: 0 }}>
          <Fact label={t('hub.about.appLine')} value={stampText(app)} />
          <Fact label={t('hub.about.serverLine')} value={serverValue} />
          <Fact label={t('hub.about.license')} value={t('hub.about.licenseValue')} />
        </Stack>
        {server.status === 'ok' && serverIsNewer(app.version, server.stamp.version) && (
          <UpdateHint server={server.stamp.version} />
        )}
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Button variant="outlined" onClick={() => void copy()} sx={{ minHeight: 44 }}>
            {t('hub.about.copy')}
          </Button>
          <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">
            {copied === 'yes' && t('hub.about.copied')}
            {copied === 'failed' && t('hub.about.copyFailed')}
          </Typography>
        </Stack>
        <Link
          component={RouterLink}
          to={`${basePath}/credits`}
          sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
          {t('hub.about.credits')}
        </Link>
        <Link
          component={RouterLink}
          to={`${basePath}/privacy`}
          sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
          {t('hub.about.privacy')}
        </Link>
        {source && (
          <Link
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
          >
            {t('hub.about.source')}
          </Link>
        )}
      </Stack>
    </Paper>
  );
}
