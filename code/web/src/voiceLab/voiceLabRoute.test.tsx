import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Before any import below runs: this file is a build with the voice test (VITE_VOICE_LAB=true).
vi.hoisted(() => {
  vi.stubEnv('VITE_VOICE_LAB', 'true');
});

import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { setSpeechPluginForTests, type LottiesSpeechPlugin } from '../platform/speech';
import { clearAccountDeviceState } from '../session/deviceState';
import { readVoiceTestOptIn, writeVoiceTestOptIn } from '../settings/voiceTestOptIn';
import { testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { voiceLabEnabled } from './featureFlag';

/*
 * A build with the voice test (docs/design/49a-voice-lab.md section 0): offered only inside the phone
 * app, off until the person turns it on in Settings > Experimental (after the explainer), and the
 * phone's permission is never asked by the switch: only a tap to speak inside the test could ask.
 */

type Scope = { Capacitor?: unknown };
let db: BabyRoutineDb;
let pluginCalls: string[];

function fakePlugin(): LottiesSpeechPlugin {
  const call = (name: string) => {
    pluginCalls.push(name);
  };
  return {
    async capabilities() {
      call('capabilities');
      return {
        osVersion: '15 (API 35)',
        recognitionAvailable: true,
        onDeviceAvailable: true,
        languageInstalled: true,
        canDownload: false,
        biasing: true,
        microphonePermission: 'prompt',
        speechPermission: 'not_needed',
      };
    },
    async listenOnce() {
      call('listenOnce');
      return new Promise(() => undefined);
    },
    async cancel() {
      call('cancel');
    },
    async downloadModel() {
      call('downloadModel');
      return { status: 'unsupported' };
    },
    async addListener() {
      call('addListener');
      return { remove: async () => undefined };
    },
  };
}

function insideTheApp(native: boolean) {
  (globalThis as Scope).Capacitor = native
    ? { isNativePlatform: () => true, getPlatform: () => 'android' }
    : undefined;
}

beforeEach(async () => {
  db = testDatabase();
  pluginCalls = [];
  setSpeechPluginForTests(fakePlugin());
  writeVoiceTestOptIn(false);
  await seedBaby(db);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  delete (globalThis as Scope).Capacitor;
  setSpeechPluginForTests(null);
  writeVoiceTestOptIn(false);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const experimental = () => screen.findByRole('button', { name: 'Experimental' });

describe('a build with the voice test, in a browser', () => {
  it('has no Experimental group, and /lab/voice goes back to Settings without starting anything', async () => {
    expect(voiceLabEnabled()).toBe(true);
    insideTheApp(false);
    writeVoiceTestOptIn(true);
    const settings = renderWithDb(db, <AppRoutes />, { route: '/settings' });
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Experimental' })).toBeNull();
    settings.unmount();

    renderWithDb(db, <AppRoutes />, { route: '/lab/voice' });
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(screen.queryByTestId('voice-lab')).toBeNull();
    expect(pluginCalls).toEqual([]);
  });
});

describe('a build with the voice test, inside the phone app', () => {
  beforeEach(() => insideTheApp(true));

  it('is off by default: no button to the test, and /lab/voice goes back to Settings', async () => {
    renderWithDb(db, <AppRoutes />, { route: '/lab/voice' });
    const group = await experimental();
    expect(group.getAttribute('aria-expanded')).toBe('true');
    const row = screen.getByRole('switch', { name: /Hands-free \(voice test\)/ });
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Open voice test' })).toBeNull();
    expect(screen.queryByTestId('voice-lab')).toBeNull();
    expect(pluginCalls).toEqual([]);
  });

  it('explains before turning on, asks for no permission, then opens the test', async () => {
    const settings = renderWithDb(db, <AppRoutes />, { route: '/settings#experimental' });
    await experimental();
    fireEvent.click(screen.getByRole('switch', { name: /Hands-free \(voice test\)/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Turn on the voice test?' }));
    expect(dialog.getByText(/records nothing and changes no baby data/)).toBeTruthy();
    expect(dialog.getByText(/only after you tap to speak/)).toBeTruthy();
    expect(dialog.getByText(/Lotties does not record or send the audio/)).toBeTruthy();
    expect(dialog.getByText(/turn it off at any time/)).toBeTruthy();

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(readVoiceTestOptIn()).toBe(false);
    expect(screen.getByRole('switch', { name: /Hands-free/ }).getAttribute('aria-checked')).toBe(
      'false',
    );

    fireEvent.click(screen.getByRole('switch', { name: /Hands-free/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn on' }),
    );
    expect(readVoiceTestOptIn()).toBe(true);
    const link = await screen.findByRole('link', { name: 'Open voice test' });
    expect(link.getAttribute('href')).toBe('/lab/voice');
    // Toggling never reached the speech plugin: the phone asks only at the first tap to speak.
    expect(pluginCalls).toEqual([]);
    settings.unmount();

    renderWithDb(db, <AppRoutes />, { route: '/lab/voice' });
    expect(
      await screen.findByRole('heading', { name: 'Voice test (experimental)', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText('Nothing is recorded.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Try it' }).getAttribute('aria-checked')).toBe('true');
    // Opening the page only asks what the phone can do (no permission prompt): nothing listens.
    expect(pluginCalls.filter((name) => name !== 'capabilities')).toEqual([]);
  });

  it('turning it off sends the open test back to Settings and drops what it held', async () => {
    writeVoiceTestOptIn(true);
    renderWithDb(db, <AppRoutes />, { route: '/lab/voice' });
    await screen.findByTestId('voice-lab');
    act(() => writeVoiceTestOptIn(false));
    expect(await experimental()).toBeTruthy();
    expect(screen.queryByTestId('voice-lab')).toBeNull();
  });

  it('is part of the account: sign-out and another account start with it off', async () => {
    writeVoiceTestOptIn(true);
    renderWithDb(db, <AppRoutes />, { route: '/lab/voice' });
    await screen.findByTestId('voice-lab');
    act(() => clearAccountDeviceState());
    expect(readVoiceTestOptIn()).toBe(false);
    expect(await experimental()).toBeTruthy();
    expect(screen.queryByTestId('voice-lab')).toBeNull();
  });
});
