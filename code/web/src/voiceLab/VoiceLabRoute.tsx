import { Navigate } from 'react-router-dom';
import { voiceTestOffered } from './featureFlag';
import { useVoiceTestOptIn } from './useVoiceTestOptIn';
import VoiceLabPage from './VoiceLabPage';

/** Where the voice test sends a person who has not turned it on (or cannot, outside the phone app). */
export const VOICE_TEST_SETTINGS = '/settings#experimental';

/**
 * /lab/voice: the voice test only inside the phone app and only after the person turned it on in
 * Settings > Experimental; otherwise back to Settings, and nothing starts. Turning it off (or signing
 * out, which clears the opt-in) while the page is open sends her back too: the page unmounts, which
 * cancels a listen in progress and drops every result it held in memory.
 */
export default function VoiceLabRoute() {
  const optedIn = useVoiceTestOptIn();
  if (!voiceTestOffered() || !optedIn) return <Navigate to={VOICE_TEST_SETTINGS} replace />;
  return <VoiceLabPage />;
}
