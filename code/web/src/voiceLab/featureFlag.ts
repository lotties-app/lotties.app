/*
 * The voice lab's switch (docs/design/49a-voice-lab.md; design 49 section 7.2), the VITE_CRY_MONITOR
 * pattern: off unless the build sets VITE_VOICE_LAB=true. Off, the app has no /lab/voice route, Settings >
 * Voice assistants has no line to it, and the bundle holds no lab page (its chunk is only referenced
 * behind this constant, so the build drops it). The lab exists only on the spike branch, where
 * code/web/.env.native turns it on for the phone builds.
 */

/** The build-time variable that turns the voice lab on. */
export const VOICE_LAB_FLAG = 'VITE_VOICE_LAB';

/** Whether these build values turn the voice lab on (only the exact value `true`). */
export function voiceLabFlagOn(env: Readonly<Record<string, unknown>>): boolean {
  return env[VOICE_LAB_FLAG] === 'true';
}

/** Whether this build has the voice lab. */
export function voiceLabEnabled(): boolean {
  return import.meta.env.VITE_VOICE_LAB === 'true';
}
