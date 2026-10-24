import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import type { Baby, EventType } from '../db/models';
import { formatDate, formatTime } from '../i18n/format';
import { currentInstallPlatform, type InstallPlatform } from '../install/installPlatform';
import { Icon } from '../ui/Icon';
import { ListeningView } from './ListeningView';
import type { MonitorFailure } from './monitorState';
import { clearCryMonitorConsent, readConsent } from './monitorStorage';
import { deniedStepsFor } from './monitorView';
import { RecentDetections } from './RecentDetections';
import type { WakeLockEnvironment } from './screenWakeLock';
import { useCryMonitor, type CreateCryEngine } from './useCryMonitor';

export interface CryMonitorScreenProps {
  baby: Baby;
  types: readonly EventType[];
  /** Tests and the developer preview: a fake engine instead of the microphone and the model. */
  createEngine?: CreateCryEngine;
  wakeLockEnvironment?: WakeLockEnvironment;
  supported?: boolean;
  /** Tests and the developer preview: the platform the denied steps and the wake lock note are for. */
  platform?: InstallPlatform;
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: 'info' | 'lock';
  children: ReactNode;
}) {
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={1}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon name={icon} size={20} />
            <Typography variant="h6" component="h2">
              {title}
            </Typography>
          </Box>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Points({ items }: { items: readonly string[] }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75 }}>
      {items.map((item) => (
        <Typography key={item} component="li">
          {item}
        </Typography>
      ))}
    </Box>
  );
}

/** What the monitor does, its limits and the privacy promise; Start (or Continue to the consent). */
function Intro({
  name,
  consentAt,
  onStart,
  onWithdraw,
}: {
  name: string;
  consentAt: string | null;
  onStart: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography>{t('cryMonitor.intro.lead', { name })}</Typography>
      <Section title={t('cryMonitor.intro.howTitle')} icon="info">
        <Points
          items={[
            t('cryMonitor.intro.how.device'),
            t('cryMonitor.intro.how.power'),
            t('cryMonitor.intro.how.stop'),
          ]}
        />
      </Section>
      <Section title={t('cryMonitor.intro.privacyTitle')} icon="lock">
        <Points
          items={[
            t('cryMonitor.intro.privacy.onlyOpen'),
            t('cryMonitor.intro.privacy.onDevice'),
            t('cryMonitor.intro.privacy.saved'),
          ]}
        />
      </Section>
      <Alert severity="warning" component="section" aria-labelledby="cry-monitor-limits">
        <Typography id="cry-monitor-limits" component="h2" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t('cryMonitor.intro.limitsTitle')}
        </Typography>
        <Points
          items={[
            t('cryMonitor.intro.limits.notSafety'),
            t('cryMonitor.intro.limits.miss'),
            t('cryMonitor.intro.limits.beta'),
            t('cryMonitor.intro.limits.rely'),
          ]}
        />
      </Alert>
      <Button
        variant="contained"
        size="large"
        onClick={onStart}
        startIcon={<Icon name={consentAt ? 'microphone' : 'arrow-right'} size={24} />}
        sx={{ minHeight: 64, borderRadius: '999px', fontSize: '1.0625rem' }}
      >
        {consentAt ? t('cryMonitor.intro.start') : t('cryMonitor.intro.continue')}
      </Button>
      {consentAt && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('cryMonitor.intro.consentGiven', { date: formatDate(consentAt, 'dayMonthYear') })}
          </Typography>
          <Button size="small" onClick={onWithdraw} sx={{ minHeight: 44 }}>
            {t('cryMonitor.intro.withdraw')}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/** The separate consent step, once per device and consent version. */
function Consent({
  name,
  onAgree,
  onCancel,
}: {
  name: string;
  onAgree: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [understand, setUnderstand] = useState(false);
  const [allowed, setAllowed] = useState(false);
  return (
    <Card component="section" aria-labelledby="cry-monitor-consent">
      <CardContent>
        <Stack spacing={2}>
          <Typography id="cry-monitor-consent" variant="h6" component="h2">
            {t('cryMonitor.consent.title')}
          </Typography>
          <Typography>{t('cryMonitor.consent.lead')}</Typography>
          <Points
            items={[
              t('cryMonitor.consent.points.microphone'),
              t('cryMonitor.consent.points.saved', { name }),
              t('cryMonitor.consent.points.others'),
              t('cryMonitor.consent.points.limits'),
              t('cryMonitor.consent.points.stop'),
            ]}
          />
          <Box sx={{ display: 'grid' }}>
            <FormControlLabel
              control={
                <Checkbox checked={understand} onChange={(e) => setUnderstand(e.target.checked)} />
              }
              label={t('cryMonitor.consent.understand')}
              sx={{ minHeight: 48 }}
            />
            <FormControlLabel
              control={
                <Checkbox checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
              }
              label={t('cryMonitor.consent.allowed')}
              sx={{ minHeight: 48 }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              disabled={!understand || !allowed}
              onClick={onAgree}
              sx={{ minHeight: 48, flex: '1 1 160px', borderRadius: '999px' }}
            >
              {t('cryMonitor.consent.agree')}
            </Button>
            <Button
              variant="outlined"
              onClick={onCancel}
              sx={{ minHeight: 48, flex: '1 1 160px', borderRadius: '999px' }}
            >
              {t('cryMonitor.consent.cancel')}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Loading({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <Card component="section" aria-labelledby="cry-monitor-loading" aria-busy="true">
      <CardContent>
        <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 2 }}>
          <CircularProgress aria-hidden />
          <Typography id="cry-monitor-loading" variant="h6" component="h2" role="status">
            {t('cryMonitor.loading.title')}
          </Typography>
          <Typography color="text.secondary">{t('cryMonitor.loading.body')}</Typography>
          <Button
            variant="outlined"
            onClick={onCancel}
            sx={{ minHeight: 48, borderRadius: '999px' }}
          >
            {t('cryMonitor.loading.cancel')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** A failure as a card with one action (none when this device cannot run it). */
function FailureCard({
  failure,
  at,
  platform,
  onRetry,
}: {
  failure: MonitorFailure;
  at: number | null;
  platform: InstallPlatform;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const time = at === null ? '' : formatTime(at);
  const steps = deniedStepsFor(platform);
  return (
    <Card
      component="section"
      aria-labelledby="cry-monitor-failure"
      data-testid={`failure-${failure}`}
    >
      <CardContent>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon name={failure === 'unsupported' ? 'info' : 'warning'} size={24} />
            <Typography id="cry-monitor-failure" variant="h6" component="h2" role="alert">
              {t(`cryMonitor.failure.${failure}.title`)}
            </Typography>
          </Box>
          <Typography>{t(`cryMonitor.failure.${failure}.body`, { time })}</Typography>
          {failure === 'denied' && (
            <Box
              component="ol"
              aria-label={t('cryMonitor.failure.denied.stepsLabel')}
              sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75 }}
            >
              <Typography component="li">
                {t(`cryMonitor.failure.denied.steps.${steps}.open`)}
              </Typography>
              <Typography component="li">
                {t(`cryMonitor.failure.denied.steps.${steps}.allow`)}
              </Typography>
              <Typography component="li">{t('cryMonitor.failure.denied.steps.retry')}</Typography>
            </Box>
          )}
          {failure !== 'unsupported' && (
            <Button
              variant="contained"
              onClick={onRetry}
              sx={{ minHeight: 56, borderRadius: '999px' }}
            >
              {failure === 'lost' || failure === 'stalled'
                ? t('cryMonitor.failure.restart')
                : t('cryMonitor.failure.tryAgain')}
            </Button>
          )}
          {/* "Not supported" has no action: the page's own way back leads to the Hub. */}
        </Stack>
      </CardContent>
    </Card>
  );
}

function NotificationsRow() {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <Box sx={{ color: 'text.secondary', pt: 0.25 }}>
        <Icon name="bell" size={20} />
      </Box>
      <Typography variant="body2" color="text.secondary">
        {t('cryMonitor.intro.notifications')}:{' '}
        <Link component={RouterLink} to="/settings#notifications">
          {t('cryMonitor.intro.notificationsLink')}
        </Link>
      </Typography>
    </Box>
  );
}

/**
 * The cry monitor for one baby (docs/design/35-cry-engine.md section 8): intro and limits, the
 * consent step, loading, the listening screen (a full-screen night view) and the failure cards, plus
 * the recent detections the parent can answer from this device.
 */
export function CryMonitorScreen({
  baby,
  types,
  createEngine,
  wakeLockEnvironment,
  supported,
  platform: platformProp,
}: CryMonitorScreenProps) {
  const monitor = useCryMonitor({
    babyId: baby.id,
    types,
    ...(createEngine ? { createEngine } : {}),
    ...(wakeLockEnvironment ? { wakeLockEnvironment } : {}),
    ...(supported === undefined ? {} : { supported }),
  });
  const [platform] = useState(() => platformProp ?? currentInstallPlatform());
  const [consentAt, setConsentAt] = useState(() => readConsent()?.at ?? null);
  const { state } = monitor;
  // The listening screen has its own list; consent and "not supported" show nothing else.
  const showRecent =
    state.phase === 'intro' ||
    state.phase === 'loading' ||
    (state.phase === 'failure' && state.failure !== 'unsupported');

  return (
    <Stack spacing={3}>
      {state.phase === 'intro' && (
        <Intro
          name={baby.name}
          consentAt={consentAt}
          onStart={() => void monitor.start()}
          onWithdraw={() => {
            clearCryMonitorConsent();
            setConsentAt(null);
          }}
        />
      )}
      {state.phase === 'consent' && (
        <Consent
          name={baby.name}
          onAgree={() => {
            monitor.agree();
            setConsentAt(readConsent()?.at ?? null);
          }}
          onCancel={monitor.cancelConsent}
        />
      )}
      {state.phase === 'loading' && <Loading onCancel={monitor.stop} />}
      {state.phase === 'failure' && (
        <FailureCard
          failure={state.failure}
          at={state.at}
          platform={platform}
          onRetry={() => void monitor.start()}
        />
      )}
      {state.phase === 'listening' && (
        <ListeningView
          baby={baby}
          types={types}
          since={state.since}
          monitor={monitor}
          platform={platform}
        />
      )}
      {showRecent && <RecentDetections baby={baby} types={types} />}
      {state.phase === 'intro' && <NotificationsRow />}
    </Stack>
  );
}
