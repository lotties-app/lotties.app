import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import type { DownloadStatus, SpeechCapabilities } from '../platform/speechTypes';
import type { Capabilities } from './useCapabilities';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'end', overflowWrap: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

type LanguageState = 'installed' | 'pending' | 'downloadable' | 'missing' | 'unknown';

function languageState(c: SpeechCapabilities): LanguageState {
  if (c.languageInstalled === true) return 'installed';
  if (c.languagePending === true) return 'pending';
  if (c.languageDownloadable === true) return 'downloadable';
  if (c.languageInstalled === false) return 'missing';
  return 'unknown';
}

function Rows({ c }: { c: SpeechCapabilities }) {
  const { t } = useTranslation();
  const yesNo = (value: boolean | null) =>
    t(`voiceLab.capabilities.${value === null ? 'unknown' : value ? 'yes' : 'no'}`);
  return (
    <>
      <Row
        label={t('voiceLab.capabilities.platform')}
        value={t(`voiceLab.capabilities.platforms.${c.platform}`)}
      />
      {c.osVersion && <Row label={t('voiceLab.capabilities.os')} value={c.osVersion} />}
      <Row label={t('voiceLab.capabilities.recognition')} value={yesNo(c.recognitionAvailable)} />
      <Row label={t('voiceLab.capabilities.onDevice')} value={yesNo(c.onDeviceAvailable)} />
      {c.onDeviceReason && (
        <Typography variant="body2" color="text.secondary">
          {t('voiceLab.capabilities.reason', { reason: c.onDeviceReason })}
        </Typography>
      )}
      <Row
        label={t('voiceLab.capabilities.language')}
        value={t(`voiceLab.capabilities.languageState.${languageState(c)}`)}
      />
      <Row label={t('voiceLab.capabilities.biasing')} value={yesNo(c.biasing)} />
      <Row
        label={t('voiceLab.capabilities.microphone')}
        value={t(`voiceLab.capabilities.permission.${c.microphone}`)}
      />
      <Row
        label={t('voiceLab.capabilities.speech')}
        value={t(`voiceLab.capabilities.permission.${c.speech}`)}
      />
      <Row label={t('voiceLab.capabilities.webSpeech')} value={yesNo(c.webSpeech)} />
    </>
  );
}

/** What the phone reports for the chosen language, and the language download where Android offers it. */
export function CapabilitiesBox({ capabilities }: { capabilities: Capabilities }) {
  const { t } = useTranslation();
  const [download, setDownload] = useState<DownloadStatus | null>(null);
  const { state } = capabilities;
  const offerDownload =
    state.status === 'ready' &&
    state.value.canDownload &&
    state.value.languageInstalled !== true &&
    state.value.languagePending !== true;

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="voice-lab-capabilities">
      <Stack spacing={1}>
        <Typography variant="subtitle1" component="h2">
          {t('voiceLab.capabilities.title')}
        </Typography>
        {state.status === 'loading' && (
          <Typography variant="body2" role="status">
            {t('voiceLab.capabilities.loading')}
          </Typography>
        )}
        {state.status === 'failed' && (
          <Typography variant="body2" color="error">
            {t('voiceLab.capabilities.failed')}
          </Typography>
        )}
        {state.status === 'ready' && <Rows c={state.value} />}
        {download && (
          <Typography variant="body2" role="status">
            {t(`voiceLab.capabilities.downloadStatus.${download}`)}
          </Typography>
        )}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button size="small" onClick={capabilities.refresh}>
            {t('voiceLab.capabilities.refresh')}
          </Button>
          {offerDownload && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => void capabilities.download().then(setDownload)}
            >
              {t('voiceLab.capabilities.download')}
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
