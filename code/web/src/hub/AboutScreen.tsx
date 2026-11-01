import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Link, Paper, Stack, Typography } from '@mui/material';
import { readBuildInfo } from '../config/buildInfo';
import { useServerVersion } from '../config/serverVersion';
import { displayVersion, shortCommit, type VersionStamp } from '../config/versionInfo';
import { formatDateTime } from '../i18n/format';
import { repoUrl } from '../landing/repoUrl';
import { applyUpdate, useUpdateSnapshot } from '../pwa/updateStore';
import { RADIUS } from '../theme/tokens';
import { isNativeApp } from '../platform/nativeApp';
import { copyText } from '../util/copyText';
import { refreshWidgetNow, useWidgetStatus } from '../widgets/widgetStatus';

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

/** Native app only: whether the home-screen widget got its data (docs/design/37-widgets-siri.md). */
function WidgetFact() {
  const { t } = useTranslation();
  const status = useWidgetStatus();
  const value =
    status.state === 'ok'
      ? t('hub.about.widgetOk', { date: formatDateTime(status.at) }) +
        (status.detail ? ` · ${status.detail}` : '')
      : status.state === 'error'
        ? t('hub.about.widgetError', { message: status.message })
        : status.state === 'working'
          ? t(status.step === 'reading' ? 'hub.about.widgetReading' : 'hub.about.widgetSending')
          : t('hub.about.widgetWaiting');
  return (
    <div>
      <Fact label={t('hub.about.widgetLine')} value={value} />
      <Button size="small" onClick={() => void refreshWidgetNow()} sx={{ minHeight: 44 }}>
        {t('hub.about.widgetRefresh')}
      </Button>
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
 * A new version of the app is installed and waiting (the service worker update state, the same
 * signal as Hub > Check for updates): offer the reload. Never driven by comparing versions.
 */
function UpdateReady() {
  const { t } = useTranslation();
  return (
    <Alert severity="info">
      <Typography sx={{ fontWeight: 600 }}>{t('hub.about.updateHint')}</Typography>
      <Typography variant="body2">{t('hub.updates.readyHint')}</Typography>
      <Button variant="contained" onClick={() => void applyUpdate()} sx={{ mt: 1, minHeight: 44 }}>
        {t('hub.updates.reload')}
      </Button>
    </Alert>
  );
}

const SERVER_STATUS_KEY = {
  loading: 'hub.about.serverLoading',
  unavailable: 'hub.about.serverUnavailable',
} as const;

/**
 * Hub > About: what this device runs and what the server runs (release, commit, build time, stamped
 * by the deploy), the reload when a new app version is waiting, a neutral note when the two differ
 * (the deploy rebuilds only the image that changed), "Copy version info" for bug reports, and the
 * licence. The server's version loads after the screen, with a short timeout.
 */
export function AboutScreen({ basePath = '/hub' }: { basePath?: string }) {
  const { t } = useTranslation();
  const app = readBuildInfo();
  const server = useServerVersion();
  const stampText = useStampText();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const source = repoUrl();
  const updateReady = useUpdateSnapshot().state === 'ready';

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
          {isNativeApp() && <WidgetFact />}
          <Fact label={t('hub.about.license')} value={t('hub.about.licenseValue')} />
        </Stack>
        {updateReady && <UpdateReady />}
        {!updateReady && server.status === 'ok' && server.stamp.version !== app.version && (
          <Typography variant="body2" color="text.secondary">
            {t('hub.about.updatedSeparately')}
          </Typography>
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
