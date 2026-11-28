import { isNativeApp } from '../platform/nativeApp';

/*
 * The voice test's build switch (docs/design/49a-voice-lab.md; design 49 section 7.2), the
 * VITE_CRY_MONITOR pattern: off unless the build sets VITE_VOICE_LAB=true. Off, the app has no
 * /lab/voice route, Settings has no Experimental row, and the bundle holds no voice test code (its
 * chunks are only referenced behind the inline comparison, so the build drops them). The phone builds
 * turn it on (code/web/.env.native); even there the test is offered only inside the phone app and only
 * runs after the person turns it on in Settings > Experimental (settings/voiceTestOptIn.ts).
 */

/** The build-time variable that turns the voice test on. */
export const VOICE_LAB_FLAG = 'VITE_VOICE_LAB';

/** Whether these build values turn the voice test on (only the exact value `true`). */
export function voiceLabFlagOn(env: Readonly<Record<string, unknown>>): boolean {
  return env[VOICE_LAB_FLAG] === 'true';
}

/** Whether this build has the voice test. */
export function voiceLabEnabled(): boolean {
  return import.meta.env.VITE_VOICE_LAB === 'true';
}

/** Whether the voice test can be offered here: a build with it, inside the iOS or Android app. */
export function voiceTestOffered(native: boolean = isNativeApp()): boolean {
  return voiceLabEnabled() && native;
}
