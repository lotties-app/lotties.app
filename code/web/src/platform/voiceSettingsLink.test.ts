import { describe, expect, it, vi } from 'vitest';
import { fakeNativeShell } from './nativeTestKit';
import { followVoiceSettingsLink, VOICE_SETTINGS_LINK } from './voiceSettingsLink';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the Android voice shortcuts\' "connect first" link', () => {
  it('opens Settings > Voice assistants while the app runs', async () => {
    const shell = fakeNativeShell();
    const navigate = vi.fn();
    followVoiceSettingsLink(shell, navigate);
    await settle();
    shell.openAppUrl(VOICE_SETTINGS_LINK);
    expect(navigate).toHaveBeenCalledWith('/settings#voice-assistants');
  });

  it('also when the link started the app', async () => {
    const shell = fakeNativeShell();
    shell.launch = VOICE_SETTINGS_LINK;
    const navigate = vi.fn();
    followVoiceSettingsLink(shell, navigate);
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('ignores the sign-in redirects and stops listening when stopped', async () => {
    const shell = fakeNativeShell();
    const navigate = vi.fn();
    const stop = followVoiceSettingsLink(shell, navigate);
    await settle();
    shell.openAppUrl('app.lotties.app://siri/callback?code=1&state=2');
    shell.openAppUrl('app.lotties.app://auth/callback?code=1&state=2');
    expect(navigate).not.toHaveBeenCalled();
    stop();
    expect(shell.listenerCount()).toBe(0);
  });
});
