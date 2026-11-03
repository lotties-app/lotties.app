import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { useTestLocale } from '../test/locale';
import { renderUi } from '../test/renderUi';
import { VoiceCommandsScreen } from './VoiceCommandsScreen';

/* Settings > Voice assistants > Voice commands: one tab per assistant, commands grouped by topic. */

let undoNative: (() => void) | undefined;

afterEach(async () => {
  undoNative?.();
  undoNative = undefined;
  await useTestLocale('en');
});

describe('VoiceCommandsScreen', () => {
  it('opens on Alexa in a browser and lists phrases, actions and answers by topic', () => {
    renderUi(<VoiceCommandsScreen />);
    expect(screen.getByRole('tab', { name: 'Alexa' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('“The baby fell asleep”')).toBeTruthy();
    expect(screen.getByText('Got it. The baby fell asleep at 1:10 PM.')).toBeTruthy();
    for (const topic of ['Log', 'Ask', 'Undo', 'Medicines']) {
      expect(screen.getByRole('heading', { name: topic })).toBeTruthy();
    }
    expect(screen.getByText('“Is any medicine due?”')).toBeTruthy();
  });

  it('shows the Siri phrases and no medicine command on the Siri tab', () => {
    renderUi(<VoiceCommandsScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Siri' }));
    expect(screen.getByText('“Log a bottle in Lotties”')).toBeTruthy();
    expect(screen.queryByText('“Is any medicine due?”')).toBeNull();
    expect(screen.getByText('Nothing: there is no medicine command')).toBeTruthy();
  });

  it('opens on the Android tab inside the Android app', () => {
    undoNative = pretendNativeApp('android');
    renderUi(<VoiceCommandsScreen />);
    expect(screen.getByRole('tab', { name: 'Android' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Log a wet diaper')).toBeTruthy();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderUi(<VoiceCommandsScreen />);
    expect(screen.getByText('“O bebê dormiu”')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Remédios' })).toBeTruthy();
  });
});
