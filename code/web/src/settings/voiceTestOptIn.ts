/*
 * The opt-in of the experimental voice test (docs/design/49a-voice-lab.md section 0): off until the
 * person turns it on in Settings > Experimental, on a phone app build that has the voice test. Kept on
 * this device for the signed-in account, like the cry monitor's consent: cleared with the account's
 * other entries at sign-out and when another account signs in (session/deviceState.ts), so a different
 * account on the same phone starts with it off. It holds no recognised text and no setting of the
 * test itself. Storage may be unavailable (private mode): reads then say "off".
 *
 * This file stays outside voiceLab/ on purpose: the sign-out clean-up imports it statically, and the
 * app entry must never reach the voice test's code (voiceLab/voiceLabSwitch.test.tsx).
 */

const KEY = 'lotties.voice-test.opt-in';
const ON = 'on';

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Whether the person turned the voice test on, on this device, for this account. */
export function readVoiceTestOptIn(): boolean {
  try {
    return window.localStorage.getItem(KEY) === ON;
  } catch {
    return false;
  }
}

export function writeVoiceTestOptIn(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY, ON);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the switch reads off next time.
  }
  notify();
}

/** Turns the voice test off on this device (also part of the sign-out clean-up). */
export function clearVoiceTestOptIn(): void {
  writeVoiceTestOptIn(false);
}

/** Calls `listener` when the opt-in changes here or in another tab of the same origin. */
export function subscribeVoiceTestOptIn(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
