import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { writeVoiceTestOptIn } from '../settings/voiceTestOptIn';
import { SettingsSection } from '../settings/SettingsSection';
import { SwitchRow } from '../ui/form';
import { voiceTestOffered } from './featureFlag';
import { useVoiceTestOptIn } from './useVoiceTestOptIn';

/** The points of the explainer, in order (voiceLab.optIn.points.*). */
const POINTS = ['experimental', 'nothingRecorded', 'microphone', 'onPhone', 'turnOff'] as const;

/** Shown before the switch turns on: what the test is and is not. Never asks for a permission. */
function Explainer({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onClose={onCancel} aria-labelledby="voice-test-optin-title">
      <DialogTitle id="voice-test-optin-title">{t('voiceLab.optIn.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {POINTS.map((point) => (
              <Typography key={point} component="li" variant="body2" sx={{ mb: 1 }}>
                {t(`voiceLab.optIn.points.${point}`)}
              </Typography>
            ))}
          </Box>
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} sx={{ minHeight: 44 }}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={onConfirm} sx={{ minHeight: 44 }}>
          {t('voiceLab.optIn.turnOn')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Settings > Experimental, the voice test's switch (docs/design/49a-voice-lab.md section 0): off by
 * default; turning it on first shows the explainer; on, a button opens the test. The microphone
 * permission is asked by the phone only at the first tap to speak inside the test, never here.
 */
export function VoiceTestSection({ expanded }: { expanded: boolean }) {
  const { t } = useTranslation();
  const on = useVoiceTestOptIn();
  const [asking, setAsking] = useState(false);
  return (
    <SettingsSection
      id="experimental"
      title={t('voiceLab.settings.section')}
      defaultExpanded={expanded}
    >
      <Stack spacing={1.5} data-testid="voice-test-setting">
        <SwitchRow
          checked={on}
          onChange={(next) => (next ? setAsking(true) : writeVoiceTestOptIn(false))}
          label={t('voiceLab.settings.switch')}
          description={t('voiceLab.settings.description')}
        />
        {on && (
          <Button
            component={RouterLink}
            to="/lab/voice"
            variant="outlined"
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {t('voiceLab.settings.open')}
          </Button>
        )}
      </Stack>
      {asking && (
        <Explainer
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            writeVoiceTestOptIn(true);
            setAsking(false);
          }}
        />
      )}
    </SettingsSection>
  );
}

/**
 * The Experimental group, only inside the phone app of a build with the voice test (SettingsPage loads
 * this lazily behind VITE_VOICE_LAB, so other builds hold none of it).
 */
export default function VoiceTestSetting({ expanded }: { expanded: boolean }) {
  if (!voiceTestOffered()) return null;
  return <VoiceTestSection expanded={expanded} />;
}
