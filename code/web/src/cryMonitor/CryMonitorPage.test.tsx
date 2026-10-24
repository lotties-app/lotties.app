import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent, BabyRole } from '../db/models';
import { detectInstallPlatform } from '../install/installPlatform';
import { fakePushDevice, type FakePushDevice } from '../notifications/fakePush';
import { PushDeviceContext } from '../notifications/PushDeviceContext';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { FUSSY_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { useTestLocale as showLocale } from '../test/locale';
import { LocationProbe } from '../test/LocationProbe';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import CryMonitorPage from './CryMonitorPage';
import { FakeCryEngine, type FakeCryEngineOptions } from './fakeCryEngine';
import { hasCurrentConsent, readSensitivity, writeConsent } from './monitorStorage';
import type { WakeLockEnvironment } from './screenWakeLock';

/*
 * The cry monitor page with a scripted engine (docs/design/35-cry-engine.md section 8): the flow from
 * the intro to listening and back, the failure cards, the fussy spells it writes, the wake lock, the
 * clean-up of this device's alerts, who may open it, and axe on every state.
 */

let db: BabyRoutineDb;
/** A cry that started 10 minutes ago (the spell never starts in the device's future). */
const AT = Math.floor(Date.now() / 1000) * 1000 - 10 * 60_000;
const ANDROID = detectInstallPlatform(
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  5,
);
const CRY_TAG = `cry:${BABY_ID.replace(/-/g, '')}`;

function wakeLock(supported = true) {
  const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
  const request = vi.fn(async () => {
    const sentinel = {
      released: false,
      release: async () => {
        sentinel.released = true;
      },
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  const env: WakeLockEnvironment = {
    wakeLock: supported ? { request } : undefined,
    visibility: () => 'visible',
    onVisibilityChange: () => () => undefined,
  };
  return { env, request, sentinels };
}

interface Setup {
  role?: BabyRole;
  engine?: FakeCryEngineOptions;
  supported?: boolean;
  consent?: boolean;
  wakeLockSupported?: boolean;
}

async function renderMonitor(setup: Setup = {}) {
  await seedBaby(db, { role: setup.role ?? 'Owner', userId: 'me' });
  await db.eventTypes.bulkPut([FUSSY_TYPE, SLEEP_TYPE]);
  if (setup.consent) writeConsent();
  const engine = new FakeCryEngine(setup.engine);
  const createEngine = vi.fn(async () => engine);
  const lock = wakeLock(setup.wakeLockSupported ?? true);
  const push: FakePushDevice = fakePushDevice({ permission: 'granted', subscribed: true });
  const view = renderWithDb(
    db,
    <PushDeviceContext value={push}>
      <Routes>
        <Route
          path="/hub/cry-monitor"
          element={
            <CryMonitorPage
              createEngine={createEngine}
              wakeLockEnvironment={lock.env}
              supported={setup.supported ?? true}
              platform={ANDROID}
            />
          }
        />
        <Route path="/hub" element={<LocationProbe />} />
      </Routes>
    </PushDeviceContext>,
    { route: '/hub/cry-monitor' },
  );
  return { engine, createEngine, lock, push, view };
}

const fussySpells = async () =>
  (await db.events.toArray()).filter((event) => event.typeId === FUSSY_TYPE.id);

async function startListening(setup: Setup = {}) {
  const ctx = await renderMonitor({ consent: true, ...setup });
  fireEvent.click(await screen.findByRole('button', { name: 'Start monitoring' }));
  await screen.findByTestId('cry-listening');
  return ctx;
}

beforeEach(() => {
  window.localStorage.clear();
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

describe('the cry monitor flow', () => {
  it('asks for consent once, then starts, listens and stops, releasing everything', async () => {
    const { engine, createEngine, lock } = await renderMonitor();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cry monitor (beta)' }),
    ).toBeTruthy();
    expect(await screen.findByText(/never recorded, stored or sent anywhere/)).toBeTruthy();
    expect(screen.getByText('This is not a baby monitor and not a safety device.')).toBeTruthy();
    // The engine is not loaded before Start.
    expect(createEngine).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const agree = await screen.findByRole('button', { name: 'Agree' });
    expect(agree).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand and agree' }));
    expect(agree).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I am allowed to monitor this baby' }));
    fireEvent.click(agree);
    expect(hasCurrentConsent()).toBe(true);
    expect(createEngine).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Start monitoring' }));
    const listening = await screen.findByTestId('cry-listening');
    expect(within(listening).getByText('Listening')).toBeTruthy();
    expect(within(listening).getByText('For Lia')).toBeTruthy();
    expect(engine.starts).toEqual([{ sensitivity: 'balanced' }]);
    await waitFor(() => expect(lock.request).toHaveBeenCalledWith('screen'));
    expect(within(listening).getByText('The screen stays on while listening.')).toBeTruthy();

    fireEvent.click(within(listening).getByRole('button', { name: 'Stop' }));
    await screen.findByRole('button', { name: 'Start monitoring' });
    expect(screen.queryByTestId('cry-listening')).toBeNull();
    expect(engine.stops).toBe(1);
    expect(lock.sentinels[0].released).toBe(true);
  });

  it('cancels the consent back to the intro without starting anything', async () => {
    const { createEngine } = await renderMonitor();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await screen.findByRole('button', { name: 'Continue' });
    expect(createEngine).not.toHaveBeenCalled();
    expect(hasCurrentConsent()).toBe(false);
  });

  it('withdraws the consent on this device', async () => {
    await renderMonitor({ consent: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw consent on this device' }));
    await screen.findByRole('button', { name: 'Continue' });
    expect(hasCurrentConsent()).toBe(false);
  });

  it('shows the loading state and cancels it', async () => {
    const { engine } = await renderMonitor({ consent: true, engine: { outcome: 'pending' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Start monitoring' }));
    expect(await screen.findByText('Starting the monitor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'Start monitoring' });
    expect(engine.stops).toBe(1);
  });

  it('starts a fussy spell at the cry start, ends it at the cry end and closes this device alert', async () => {
    const { engine, push } = await startListening();
    push.state.shown = [
      { tag: CRY_TAG, data: null },
      { tag: 'nap:other', data: null },
    ];
    act(() => engine.emit('cry_started', { type: 'cry_started', at: AT, detectedAt: AT + 25_000 }));
    await waitFor(async () => expect(await fussySpells()).toHaveLength(1));
    const [spell] = await fussySpells();
    expect(spell).toMatchObject({
      startedAt: new Date(AT).toISOString(),
      endedAt: null,
      payload: { auto_detected: true },
    });
    await waitFor(() => expect(push.state.shown.map((n) => n.tag)).toEqual(['nap:other']));
    expect(await screen.findByText(/^Crying heard since/)).toBeTruthy();

    const end = AT + 6 * 60_000;
    act(() =>
      engine.emit('cry_ended', {
        type: 'cry_ended',
        at: end,
        startedAt: AT,
        closedAt: end + 180_000,
        reason: 'quiet',
      }),
    );
    await waitFor(async () =>
      expect((await fussySpells())[0].endedAt).toBe(new Date(end).toISOString()),
    );
    expect(screen.queryByText(/^Crying heard since/)).toBeNull();
  });

  it('keeps a running monitor spell and creates none over a spell started by hand', async () => {
    await seedBaby(db, { userId: 'me' });
    await db.eventTypes.bulkPut([FUSSY_TYPE]);
    const manual = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FUSSY_TYPE.id,
      startedAt: new Date(AT - 60_000).toISOString(),
    });
    const { engine } = await startListening();
    act(() => engine.emit('cry_started', { type: 'cry_started', at: AT, detectedAt: AT }));
    act(() =>
      engine.emit('cry_ended', {
        type: 'cry_ended',
        at: AT + 60_000,
        startedAt: AT,
        closedAt: AT + 240_000,
        reason: 'quiet',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const spells = await fussySpells();
    expect(spells).toHaveLength(1);
    // The parent's own spell is left running.
    expect(spells[0]).toMatchObject({ id: manual.id, endedAt: null });
  });

  it('closes the running spell when monitoring stops', async () => {
    const { engine } = await startListening();
    act(() => engine.emit('cry_started', { type: 'cry_started', at: AT, detectedAt: AT }));
    act(() => engine.emit('score', { t: AT + 30_000, score: 0.1, smoothed: 0.1, inferenceMs: 5 }));
    await waitFor(async () => expect(await fussySpells()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(async () =>
      expect((await fussySpells())[0].endedAt).toBe(new Date(AT + 30_975).toISOString()),
    );
  });

  it('changes the sensitivity while listening and keeps it on this device', async () => {
    const { engine } = await startListening();
    expect(screen.getByText(/Recommended: a balance/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'More' }));
    expect(engine.sensitivityChanges).toEqual(['more']);
    expect(readSensitivity()).toBe('more');
    expect(screen.getByText(/Also reacts to quieter crying/)).toBeTruthy();
    expect(engine.starts).toHaveLength(1);
  });

  it('warns quietly when the screen cannot be kept on, and about voice processing', async () => {
    await startListening({
      wakeLockSupported: false,
      engine: { processingOn: ['noiseSuppression'] },
    });
    expect(
      await screen.findByText(/set a longer Screen timeout in Settings > Display/),
    ).toBeTruthy();
    expect(screen.getByText(/Sensitivity may be lower on this device/)).toBeTruthy();
  });

  it('says when it is offline that crying is saved and syncs later', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await startListening();
    expect(
      screen.getByText('Offline: detected crying is saved here and syncs later.'),
    ).toBeTruthy();
  });

  it('stops everything when the page is left', async () => {
    const { engine, view, lock } = await startListening();
    view.unmount();
    expect(engine.stops).toBe(1);
    expect(lock.sentinels[0].released).toBe(true);
  });

  it('stops everything on pagehide (tab closed)', async () => {
    const { engine } = await startListening();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await screen.findByRole('button', { name: 'Start monitoring' });
    expect(engine.stops).toBe(1);
  });
});

describe('the failure cards', () => {
  it('explains a refused microphone with short steps and tries again', async () => {
    const { engine } = await renderMonitor({ consent: true, engine: { outcome: 'denied' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Start monitoring' }));
    expect(await screen.findByText('Microphone access is off')).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'How to allow the microphone' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(engine.starts).toHaveLength(2));
  });

  it('says when it stopped listening, never that it kept listening, and restarts', async () => {
    const { engine } = await startListening();
    act(() => engine.emit('cry_started', { type: 'cry_started', at: AT, detectedAt: AT }));
    act(() => engine.emit('score', { t: AT + 10_000, score: 0.1, smoothed: 0.1, inferenceMs: 5 }));
    act(() => engine.emit('stalled', { at: AT + 20_000, lastFrameAt: AT + 10_975 }));
    expect(await screen.findByText('Listening stopped')).toBeTruthy();
    expect(screen.getByText(/Nothing after that was heard/)).toBeTruthy();
    expect(screen.queryByTestId('cry-listening')).toBeNull();
    expect(engine.stops).toBe(1);
    await waitFor(async () =>
      expect((await fussySpells())[0].endedAt).toBe(new Date(AT + 10_975).toISOString()),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await screen.findByTestId('cry-listening');
  });

  it('shows "Microphone interrupted" when capture is lost', async () => {
    const { engine } = await startListening();
    act(() => engine.lose());
    expect(await screen.findByText('Microphone interrupted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
  });

  it.each([
    ['model_missing', 'Not available right now'],
    ['unavailable', 'No microphone available'],
  ] as const)('maps %s to "%s"', async (code, title) => {
    await renderMonitor({ consent: true, engine: { outcome: code } });
    fireEvent.click(await screen.findByRole('button', { name: 'Start monitoring' }));
    expect(await screen.findByText(title)).toBeTruthy();
  });

  it('says "not available right now" when the engine cannot even load', async () => {
    await seedBaby(db, { userId: 'me' });
    await db.eventTypes.bulkPut([FUSSY_TYPE]);
    writeConsent();
    renderWithDb(
      db,
      <CryMonitorPage
        supported
        createEngine={async () => {
          throw new Error('chunk failed');
        }}
        wakeLockEnvironment={wakeLock().env}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start monitoring' }));
    expect(await screen.findByText('Not available right now')).toBeTruthy();
  });

  it('says "not supported on this device" without the browser features', async () => {
    const { createEngine } = await renderMonitor({ supported: false });
    expect(await screen.findByText('Not supported on this device')).toBeTruthy();
    // No action: the page's own way back leads to the Hub.
    expect(screen.getByRole('link', { name: 'Back to Hub' }).getAttribute('href')).toBe('/hub');
    expect(screen.queryByRole('button', { name: /Start|Continue|Try again/ })).toBeNull();
    expect(createEngine).not.toHaveBeenCalled();
  });
});

describe('who can open it', () => {
  it('sends a Viewer back to the Hub', async () => {
    const { createEngine } = await renderMonitor({ role: 'Viewer' });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/hub'));
    expect(createEngine).not.toHaveBeenCalled();
  });

  it('never offers it to the Doctor (her patients are not in the family selection)', async () => {
    const { createEngine } = await renderMonitor({ role: 'Doctor' });
    await screen.findByText(/^Create a baby/);
    expect(screen.queryByRole('button', { name: /Start monitoring|Continue/ })).toBeNull();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it.each(['Owner', 'Parent', 'Caregiver'] as const)('opens for a %s', async (role) => {
    await renderMonitor({ role });
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('is not offered inside the native app', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    try {
      await renderMonitor();
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/hub'));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('recent detections', () => {
  async function seedSpell(payload: BabyEvent['payload'], minutesAgo: number) {
    const start = Date.now() - minutesAgo * 60_000;
    return createEvent(db, {
      babyId: BABY_ID,
      typeId: FUSSY_TYPE.id,
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 7 * 60_000).toISOString(),
      payload,
    });
  }

  it("lists today's monitor spells and records the parent's answer", async () => {
    await seedBaby(db, { userId: 'me' });
    await db.eventTypes.bulkPut([FUSSY_TYPE]);
    const spell = await seedSpell({ auto_detected: true }, 1);
    await seedSpell({}, 2); // started by hand: not listed
    await renderMonitor();
    const rows = await screen.findAllByTestId('cry-detection');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText(/· 7m$/)).toBeTruthy();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Not crying' }));
    await waitFor(async () =>
      expect((await db.events.get(spell.id))?.payload).toEqual({
        auto_detected: true,
        cry_confirmed: false,
      }),
    );
    expect((await db.events.get(spell.id))?.deletedAt).toBeNull();
    await waitFor(() =>
      expect(
        within(rows[0]).getByRole('button', { name: 'Not crying' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Yes, crying' }));
    await waitFor(async () =>
      expect((await db.events.get(spell.id))?.payload.cry_confirmed).toBe(true),
    );
  });

  it('says when nothing was detected today', async () => {
    await renderMonitor();
    expect(await screen.findByText('No crying detected today.')).toBeTruthy();
  });

  it('links to the notification settings instead of repeating the switch', async () => {
    await renderMonitor();
    const link = await screen.findByRole('link', { name: 'Settings > Notifications' });
    expect(link.getAttribute('href')).toBe('/settings#notifications');
  });
});

describe.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['night', 'en'],
  ['light', 'pt-BR'],
  ['dark', 'pt-BR'],
  ['night', 'pt-BR'],
] as const)('accessibility in the %s scheme, %s', (scheme, locale) => {
  const STATES = [
    'intro',
    'consent',
    'loading',
    'listening',
    'denied',
    'stalled',
    'unsupported',
  ] as const;

  async function show(state: (typeof STATES)[number]) {
    if (scheme === 'night') {
      window.localStorage.setItem(
        NIGHT_FEED_STATE_STORAGE_KEY,
        JSON.stringify({
          override: { on: true, key: nightPeriodKey(new Date()) },
          dismissedKey: null,
        }),
      );
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    }
    await showLocale(locale);
    const consent = state !== 'consent';
    const outcome: FakeCryEngineOptions['outcome'] =
      state === 'loading' ? 'pending' : state === 'denied' ? 'denied' : 'listening';
    const ctx = await renderMonitor({
      consent,
      supported: state !== 'unsupported',
      engine: { outcome },
    });
    if (state === 'unsupported') {
      await screen.findByTestId('failure-unsupported');
      return ctx;
    }
    const button = await screen.findByRole('button', {
      name: consent ? /^(Start monitoring|Começar a monitorar)$/ : /^(Continue|Continuar)$/,
    });
    if (state === 'intro') return ctx;
    fireEvent.click(button);
    if (state === 'consent')
      await screen.findByRole('checkbox', { name: /^(I understand|Entendo)/ });
    if (state === 'loading') await screen.findByRole('status');
    if (state === 'denied') await screen.findByTestId('failure-denied');
    if (state === 'listening' || state === 'stalled') await screen.findByTestId('cry-listening');
    if (state === 'stalled') {
      act(() => ctx.engine.emit('stalled', { at: AT, lastFrameAt: AT }));
      await screen.findByTestId('failure-stalled');
    }
    return ctx;
  }

  it.each(STATES)(
    'has no axe violations: %s',
    async (state) => {
      await show(state);
      const expected =
        scheme === 'light' ? 'data-light' : scheme === 'dark' ? 'data-dark' : 'data-night';
      expect(document.documentElement.hasAttribute(expected)).toBe(true);
      if (state === 'listening') {
        // The listening screen is always the night view, whatever the app's scheme.
        expect(screen.getByTestId('cry-listening').hasAttribute('data-night')).toBe(true);
      }
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    },
    30_000,
  );
});
