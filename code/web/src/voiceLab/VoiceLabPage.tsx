import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Stack, Typography } from '@mui/material';
import { speechPlatform } from '../platform/speech';
import type { SpeechPlatform } from '../platform/speechTypes';
import { CapabilitiesBox } from './CapabilitiesBox';
import { ExportResults } from './ExportResults';
import { FreeTry } from './FreeTry';
import { KeyLogger } from './KeyLogger';
import { LabSetup } from './LabSetup';
import { PhraseRunner } from './PhraseRunner';
import { SummaryTable } from './SummaryTable';
import { useCapabilities } from './useCapabilities';
import { useVoiceLab } from './useVoiceLab';

interface Props {
  /** Test seam and the /dev preview: scripted engines instead of the phone's. */
  platform?: SpeechPlatform;
  /** Test seam for the export. */
  save?: (file: Blob, name: string) => Promise<boolean>;
}

/**
 * /lab/voice, the voice lab (docs/design/49a-voice-lab.md, spike branch only, behind VITE_VOICE_LAB):
 * reads the design 49 section 7.3 phrases through the chosen engine and measures section 7.4. It
 * writes no event and nothing to Dexie, the outbox or the server, reads no baby data and logs no
 * transcript anywhere; results live in this page's memory and the exported file.
 */
export default function VoiceLabPage({ platform, save }: Props) {
  const { t } = useTranslation();
  const [speech] = useState(() => platform ?? speechPlatform());
  const lab = useVoiceLab(speech);
  const capabilities = useCapabilities(speech, lab.settings.locale);
  return (
    <Stack spacing={2} sx={{ pb: 2 }} data-testid="voice-lab">
      <Typography variant="h5" component="h1">
        {t('voiceLab.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('voiceLab.intro')}
      </Typography>
      <LabSetup lab={lab} />
      <CapabilitiesBox capabilities={capabilities} />
      <PhraseRunner lab={lab} />
      <SummaryTable records={lab.records} />
      <ExportResults records={lab.records} capabilities={capabilities.known} save={save} />
      <FreeTry lab={lab} />
      <KeyLogger />
    </Stack>
  );
}
