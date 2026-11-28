import { useSyncExternalStore } from 'react';
import { readVoiceTestOptIn, subscribeVoiceTestOptIn } from '../settings/voiceTestOptIn';

/** The person's opt-in to the voice test on this device, live (sign-out clears it). */
export function useVoiceTestOptIn(): boolean {
  return useSyncExternalStore(subscribeVoiceTestOptIn, readVoiceTestOptIn, () => false);
}
