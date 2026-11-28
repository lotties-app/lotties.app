import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Stack,
  Typography,
} from '@mui/material';
import { useLocale } from '../i18n/useLocale';
import { speechPlatform } from '../platform/speech';
import type { SpeechPlatform } from '../platform/speechTypes';
import { SegmentedControl } from '../ui/form';
import { Icon } from '../ui/Icon';
import { CapabilitiesBox } from './CapabilitiesBox';
import { ExportResults } from './ExportResults';
import { FreeTry } from './FreeTry';
import { KeyLogger } from './KeyLogger';
import { LabSetup } from './LabSetup';
import { PhraseRunner } from './PhraseRunner';
import { SummaryTable } from './SummaryTable';
import { useCapabilities, type Capabilities } from './useCapabilities';
import { useVoiceLab, type VoiceLab } from './useVoiceLab';

interface Props {
  /** Test seam and the /dev preview: scripted engines instead of the phone's. */
  platform?: SpeechPlatform;
  /** Test seam for the export. */
  save?: (file: Blob, name: string) => Promise<boolean>;
}

type Mode = 'try' | 'guided';
const MODES: readonly Mode[] = ['try', 'guided'];

/** The phone said it cannot recognise this language on the device: the test cannot run (no fallback). */
function NoOnDevice({ capabilities }: { capabilities: Capabilities }) {
  const { t } = useTranslation();
  const { state } = capabilities;
  if (state.status !== 'ready' || state.value.onDeviceAvailable !== false) return null;
  return <Alert severity="warning">{t('voiceLab.noOnDevice')}</Alert>;
}

/** What the phone reports and the key logger, folded away by default. */
function TechnicalDetails({ capabilities }: { capabilities: Capabilities }) {
  const { t } = useTranslation();
  return (
    <Accordion
      disableGutters
      slotProps={{ transition: { unmountOnExit: true } }}
      data-testid="voice-lab-technical"
    >
      <AccordionSummary expandIcon={<Icon name="expand" />} sx={{ minHeight: 56 }}>
        <Typography variant="subtitle1" component="h2">
          {t('voiceLab.technical')}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <CapabilitiesBox capabilities={capabilities} />
          <KeyLogger />
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

/** The guided test: the fixed test phrases one by one, the summary and the export. */
function GuidedTest({
  lab,
  capabilities,
  save,
}: {
  lab: VoiceLab;
  capabilities: Capabilities;
  save: Props['save'];
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2} data-testid="voice-lab-guided">
      <Typography variant="body2">{t('voiceLab.guided.hint')}</Typography>
      <LabSetup lab={lab} />
      <PhraseRunner lab={lab} />
      <SummaryTable records={lab.records} />
      <ExportResults records={lab.records} capabilities={capabilities.known} save={save} />
    </Stack>
  );
}

/**
 * /lab/voice, the experimental voice test (docs/design/49a-voice-lab.md, behind VITE_VOICE_LAB and the
 * person's opt-in, see VoiceLabRoute): "Try it" first, then the guided test of design 49 section 7.3
 * and 7.4. It writes no event and nothing to Dexie, the outbox or the server, reads no baby data and
 * logs no transcript anywhere; results live in this page's memory and, for the guided test only, the
 * file the person exports.
 */
export default function VoiceLabPage({ platform, save }: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [speech] = useState(() => platform ?? speechPlatform());
  const lab = useVoiceLab(speech, locale);
  const capabilities = useCapabilities(speech, lab.settings.locale);
  const [mode, setMode] = useState<Mode>('try');
  return (
    <Stack spacing={2} sx={{ pb: 2 }} data-testid="voice-lab">
      <Stack spacing={0.5}>
        <Typography variant="h5" component="h1">
          {t('voiceLab.title')}
        </Typography>
        <Typography sx={{ fontWeight: 600 }}>{t('voiceLab.nothingRecorded')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('voiceLab.intro')}
        </Typography>
      </Stack>
      <NoOnDevice capabilities={capabilities} />
      <SegmentedControl<Mode>
        aria-label={t('voiceLab.modes.label')}
        value={mode}
        disabled={lab.speaking !== null}
        options={MODES.map((value) => ({ value, label: t(`voiceLab.modes.${value}`) }))}
        onChange={(next) => next && setMode(next)}
      />
      {mode === 'try' ? (
        <FreeTry lab={lab} />
      ) : (
        <GuidedTest lab={lab} capabilities={capabilities} save={save} />
      )}
      <TechnicalDetails capabilities={capabilities} />
    </Stack>
  );
}
