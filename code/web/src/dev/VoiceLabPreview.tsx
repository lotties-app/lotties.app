import { useMemo } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { LAB_PHRASES } from '../voiceLab/labPhrases';
import VoiceLabPage from '../voiceLab/VoiceLabPage';
import { VoiceTestSection } from '../voiceLab/VoiceTestSetting';
import { fakeSpeech, type FakeReply, type FakeSpeechOptions } from '../voiceLab/fakeSpeech';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/voice-lab`, only in a dev server with VITE_VOICE_LAB=true): the voice test
 * over a scripted speech platform (no microphone, no plugin, no account). `?state=run` hears one pt-BR
 * bottle for the first Try it, then each pt-BR test phrase in order (the third one misheard as 105 ml,
 * right on its retry), `hang` keeps listening
 * until Cancel, `no-device` is a phone without on-device pt-BR, `settings` is the Settings >
 * Experimental group as the phone app shows it (its switch writes this browser's opt-in);
 * `&scheme=light|dark|night`.
 */

const SCENARIOS = ['run', 'hang', 'no-device', 'settings'] as const;
type Scenario = (typeof SCENARIOS)[number];

function optionsFor(scenario: Scenario): FakeSpeechOptions {
  if (scenario === 'hang') return { replies: ['hang'] };
  if (scenario === 'no-device') {
    return {
      replies: [{ error: 'on_device_unavailable' }],
      capabilities: {
        osVersion: '11 (API 30)',
        onDeviceAvailable: false,
        onDeviceReason: 'api_below_31',
        languageInstalled: null,
        languageDownloadable: null,
        languagePending: null,
        canDownload: false,
        biasing: false,
        microphone: 'prompt',
        speech: 'unknown',
      },
    };
  }
  // One Try it first; then the guided run: phrase 3 is misheard first, its retry hears it right.
  const replies: FakeReply[] = LAB_PHRASES['pt-BR'].flatMap((phrase, index): FakeReply[] =>
    index === 2
      ? [['mamadeira de cento e cinco mililitros', phrase.text], [phrase.text]]
      : [[phrase.text, `${phrase.text} a`]],
  );
  return { replies: [['mamadeira de 120 ml'], ...replies] };
}

/** Developer-only: the voice lab with scripted engines (`/dev/voice-lab?state=run`). */
export default function VoiceLabPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'run';
  const platform = useMemo(() => fakeSpeech(optionsFor(scenario)), [scenario]);
  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
      <Box component="main" sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: 4 }}>
        {scenario === 'settings' ? (
          <VoiceTestSection expanded />
        ) : (
          <VoiceLabPage key={scenario} platform={platform} save={async () => true} />
        )}
        <PreviewToolbar
          scenarios={SCENARIOS}
          scenario={scenario}
          onScenario={(next) => setParams({ state: next }, { replace: true })}
        />
      </Box>
    </Box>
  );
}
