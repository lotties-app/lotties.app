import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Dialog, Stack, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import type { CrySensitivity } from '../cry/sensitivity';
import type { Baby, EventType } from '../db/models';
import { formatDuration, formatTime } from '../i18n/format';
import type { InstallPlatform } from '../install/installPlatform';
import { useOnline } from '../sync/useOnline';
import { CONTENT_MAX_WIDTH } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { SegmentedControl } from '../ui/form';
import { SENSITIVITIES } from './monitorStorage';
import { meterFill, wakeLockNoteKey } from './monitorView';
import { RecentDetections } from './RecentDetections';
import type { CryMonitor } from './useCryMonitor';
import { babyShownName } from '../baby/shownName';

/** A slow, opacity-only pulse; none with reduced motion. */
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

function useClock(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

function Note({ icon, children }: { icon: 'info' | 'warning' | 'cloud-off'; children: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', color: 'text.secondary' }}>
      <Box sx={{ pt: 0.25, flexShrink: 0 }}>
        <Icon name={icon} size={20} />
      </Box>
      <Typography variant="body2">{children}</Typography>
    </Box>
  );
}

/**
 * The listening screen: a full-screen night view (the Lamplight tokens, near-black for OLED screens,
 * never white), with a persistent "Listening" indicator, the time, a thin level meter (never a
 * number), the sensitivity, the quiet warnings and one large Stop button that always stays in view.
 */
export function ListeningView({
  baby,
  types,
  since,
  monitor,
  platform,
}: {
  baby: Baby;
  types: readonly EventType[];
  since: number;
  monitor: CryMonitor;
  platform: InstallPlatform;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const helpId = useId();
  const now = useClock(15_000);
  const online = useOnline();
  const fill = meterFill(monitor.level, monitor.sensitivity);
  const warnScreen = monitor.wakeLock === 'unsupported' || monitor.wakeLock === 'denied';

  return (
    <Dialog
      open
      fullScreen
      aria-labelledby={titleId}
      data-night=""
      data-testid="cry-listening"
      slotProps={{ paper: { sx: { bgcolor: 'background.default', color: 'text.primary' } } }}
    >
      <Box
        sx={{
          flex: '1 1 auto',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH,
          mx: 'auto',
          px: 2,
          pt: 'calc(16px + env(safe-area-inset-top))',
        }}
      >
        <Stack spacing={2.5} sx={{ flex: '1 0 auto', pb: 2 }}>
          <Typography id={titleId} variant="overline" component="h2" color="text.secondary">
            {t('cryMonitor.listening.label')}
          </Typography>
          <Box role="status" sx={{ display: 'grid', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                aria-hidden
                data-testid="listening-dot"
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  flexShrink: 0,
                  // The night scheme turns motion off; this slow opacity pulse is the one exception,
                  // and reduced motion still turns it off.
                  '[data-night] &': { animation: `${pulse} 2.4s ease-in-out infinite !important` },
                  '@media (prefers-reduced-motion: reduce)': {
                    '[data-night] &': { animation: 'none !important' },
                  },
                }}
              />
              <Typography variant="h4" component="p">
                {t('cryMonitor.listening.status')}
              </Typography>
            </Box>
            <Typography>{t('cryMonitor.listening.for', { name: babyShownName(baby) })}</Typography>
            <Typography color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {t('cryMonitor.listening.since', {
                time: formatTime(since),
                duration: formatDuration(Math.max(0, now - since)),
              })}
            </Typography>
            {monitor.cryingSince !== null && (
              <Typography sx={{ fontWeight: 600 }}>
                {t('cryMonitor.listening.crying', { time: formatTime(monitor.cryingSince) })}
              </Typography>
            )}
          </Box>
          <Box
            aria-hidden
            data-testid="level-meter"
            sx={{ height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}
          >
            <Box
              sx={{
                height: '100%',
                width: `${Math.round(fill * 100)}%`,
                bgcolor: 'text.secondary',
                transition: 'width 0.3s linear',
              }}
            />
          </Box>
          <Stack spacing={1}>
            {!online && <Note icon="cloud-off">{t('cryMonitor.listening.offline')}</Note>}
            {warnScreen ? (
              <Note icon="warning">{t(wakeLockNoteKey(platform))}</Note>
            ) : (
              <Note icon="info">{t('cryMonitor.listening.screenOn')}</Note>
            )}
            {monitor.processingOn && (
              <Note icon="warning">{t('cryMonitor.listening.processing')}</Note>
            )}
          </Stack>
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography component="h3" variant="subtitle1">
              {t('cryMonitor.listening.sensitivity')}
            </Typography>
            <SegmentedControl<CrySensitivity>
              aria-label={t('cryMonitor.listening.sensitivity')}
              value={monitor.sensitivity}
              onChange={(value) => value && monitor.setSensitivity(value)}
              options={SENSITIVITIES.map((value) => ({
                value,
                label: t(`cryMonitor.listening.sensitivityLevels.${value}`),
              }))}
            />
            <Typography id={helpId} variant="body2" color="text.secondary" aria-live="polite">
              {t(`cryMonitor.listening.sensitivityHelp.${monitor.sensitivity}`)}
            </Typography>
          </Box>
          <RecentDetections baby={baby} types={types} headingLevel="h3" />
        </Stack>
        <Box
          sx={{
            position: 'sticky',
            bottom: 0,
            pt: 1.5,
            pb: 'calc(16px + env(safe-area-inset-bottom))',
            bgcolor: 'background.default',
          }}
        >
          <Button
            variant="contained"
            fullWidth
            onClick={monitor.stop}
            startIcon={<Icon name="stop" size={32} />}
            sx={{ minHeight: 72, borderRadius: '999px', fontSize: '1.25rem' }}
          >
            {t('cryMonitor.listening.stop')}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
