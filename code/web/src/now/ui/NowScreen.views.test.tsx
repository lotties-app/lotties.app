import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import type { PredictionsDto } from '../../sync/contract';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { readLastSeenAt, writeLastSeenAt } from '../lastSeen';
import {
  BABY,
  learningPredictions,
  minutesAgo,
  nowApi,
  pinClock,
  putEvent,
  seedMorning,
  seedNow,
  sleepPredictions,
} from './nowKit';
import { CatchUpButton } from './CatchUpButton';
import { NowScreen } from './NowScreen';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const key of ['wakeLock', 'share'] as const) {
    Reflect.deleteProperty(navigator, key);
  }
  await db.delete();
});

function renderNow(options: { predictions?: PredictionsDto | null; baby?: Baby } = {}) {
  const { api } = fakeApi(nowApi(options.predictions ?? null));
  const baby = options.baby ?? BABY;
  // The header's catch-up button (TopBar) reads what the Now screen offers.
  return renderWithDb(
    db,
    <>
      <CatchUpButton babyId={baby.id} />
      <NowScreen baby={baby} />
    </>,
    { api },
  );
}

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);

function stubWakeLock() {
  const sentinel = { released: false, release: vi.fn(async () => undefined) };
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { sentinel, request };
}

function startNightView() {
  window.localStorage.setItem(
    NIGHT_FEED_STATE_STORAGE_KEY,
    JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
  );
}

describe('loading and empty states', () => {
  it('shows skeleton shapes while the local data loads', async () => {
    await seedNow(db);
    renderNow();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('a baby without events gets a friendly first step, with Import and Invite links', async () => {
    await seedNow(db);
    renderNow();

    expect(await screen.findByRole('heading', { name: "Log Lia's first event" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fell asleep' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Feed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Import' }).getAttribute('href')).toBe('/hub/import');
    expect(screen.getByRole('link', { name: 'Invite' }).getAttribute('href')).toBe(
      '/hub/family#invite',
    );
    expect(screen.getByText(/Log a few days and predictions appear here/)).toBeTruthy();
  });

  it('the first Asleep logs the first event and the normal screen takes over', async () => {
    // Early afternoon: a sleep started now is a nap, whatever time the suite runs at.
    pinClock(14);
    await seedNow(db);
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: 'Fell asleep' }));
    // The pill, and the middle of the day ring when it is open.
    expect((await screen.findAllByText('Asleep · Nap')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: "Log Lia's first event" })).toBeNull();
    expect((await live()).length).toBeGreaterThan(0);
  });

  it('the first Feed opens the feed tray', async () => {
    await seedNow(db);
    renderNow();
    fireEvent.click(await screen.findByRole('button', { name: 'Feed' }));
    expect(await screen.findByRole('dialog', { name: 'Feed' })).toBeTruthy();
  });

  it('parents cannot invite, and viewers can only read', async () => {
    await seedNow(db, { role: 'Parent' });
    const parent = renderNow({ baby: { ...BABY, role: 'Parent' } });
    await screen.findByRole('heading', { name: "Log Lia's first event" });
    expect(screen.getByRole('link', { name: 'Import' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Invite' })).toBeNull();
    parent.unmount();

    await seedNow(db, { role: 'Viewer' });
    renderNow({ baby: { ...BABY, role: 'Viewer' } });
    await screen.findByText('Nothing has been logged yet.');
    expect(screen.queryByRole('button', { name: 'Fell asleep' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Import' })).toBeNull();
    expect(screen.getByText(/view-only access/)).toBeTruthy();
  });

  it('says so when the baby has no event types yet', async () => {
    await db.babies.put(BABY);
    renderNow();
    expect(await screen.findByText(/No event types yet/)).toBeTruthy();
  });
});

describe('hand-over catch-up (header button)', () => {
  const BUTTON = /^What changed since your last look/;
  const TITLE = 'Since you last looked';

  async function seedHandover(options: { role?: Baby['role']; extraDiapers?: number } = {}) {
    await seedNow(db, options.role ? { role: options.role } : {});
    await seedMorning(db, 200);
    const created = minutesAgo(60);
    await putEvent(
      db,
      'sleep',
      190,
      120,
      { kind: 'nap' },
      { createdBy: 'u-ana', createdAt: created },
    );
    await putEvent(
      db,
      'feeding',
      100,
      100,
      { method: 'bottle', amount_ml: 120 },
      { createdBy: 'u-ana', createdAt: created },
    );
    await putEvent(
      db,
      'diaper',
      90,
      90,
      { content: 'WET' },
      { createdBy: 'u-ana', createdAt: created },
    );
    await putEvent(
      db,
      'medication',
      80,
      80,
      {
        medications: [
          { medicationId: 'm-paracetamol', name: 'Paracetamol', dose: { amount: 2.5, unit: 'ml' } },
        ],
      },
      { createdBy: 'u-ana', createdAt: created },
    );
    for (let i = 0; i < (options.extraDiapers ?? 0); i += 1) {
      await putEvent(
        db,
        'diaper',
        70 - i,
        70 - i,
        { content: 'WET' },
        { createdBy: 'u-ana', createdAt: created },
      );
    }
    writeLastSeenAt(BABY.id, minutesAgo(180));
  }

  const openCatchUp = async () => {
    const button = await screen.findByRole('button', { name: BUTTON });
    button.focus();
    fireEvent.click(button);
    return screen.findByRole('dialog', { name: TITLE });
  };

  it('is no longer an inline card: a header button with the count opens the summary', async () => {
    await seedHandover();
    renderNow();

    const button = await screen.findByRole('button', {
      name: 'What changed since your last look, 4 new',
    });
    expect(within(button).getByText('4')).toBeTruthy();
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull();

    const sheet = await openCatchUp();
    expect(await within(sheet).findByText(/^Ana logged 4 things since/)).toBeTruthy();
    expect(within(sheet).getByText('1 sleep')).toBeTruthy();
    expect(within(sheet).getByText('1 feed')).toBeTruthy();
    expect(within(sheet).getByText('1 diaper')).toBeTruthy();
    expect(within(sheet).getByText('Paracetamol 2.5 ml')).toBeTruthy();
  });

  it('caps the badge at 9+ (the name keeps the real count)', async () => {
    await seedHandover({ extraDiapers: 8 });
    renderNow();
    const button = await screen.findByRole('button', {
      name: 'What changed since your last look, 12 new',
    });
    expect(within(button).getByText('9+')).toBeTruthy();
  });

  it('closing (Esc) does not mark it seen and gives the focus back to the button', async () => {
    await seedHandover();
    const since = minutesAgo(180);
    writeLastSeenAt(BABY.id, since);
    renderNow();

    const sheet = await openCatchUp();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    const button = screen.getByRole('button', { name: BUTTON });
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(readLastSeenAt(BABY.id)).toBe(since);
  });

  it('Got it marks it seen: the sheet closes and the button goes away', async () => {
    await seedHandover();
    const since = minutesAgo(180);
    writeLastSeenAt(BABY.id, since);
    renderNow();

    const sheet = await openCatchUp();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: BUTTON })).toBeNull());
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull();
    expect(readLastSeenAt(BABY.id)).not.toBe(since);
  });

  it('Share as text uses the Web Share sheet when there is one', async () => {
    await seedHandover();
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    renderNow();

    const sheet = await openCatchUp();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Share as text' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [{ text }] = share.mock.calls[0] as unknown as [{ text: string }];
    expect(text).toMatch(/^Lia: since \d\d:\d\d\n/);
    expect(text).toContain('Ana: 1 sleep');
    expect(text).toContain('Paracetamol 2.5 ml');
  });

  it('Share as text falls back to the clipboard and says so', async () => {
    await seedHandover();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderNow();

    const sheet = await openCatchUp();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Share as text' }));
    expect(await within(sheet).findByText('Copied to the clipboard.')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Ana:'));
  });

  it('opens as a popover on wide screens', async () => {
    // jsdom has no matchMedia: a wide screen answers every min-width query.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) =>
        ({
          matches: query.includes('min-width'),
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    });
    try {
      await seedHandover();
      renderNow();
      const dialog = await openCatchUp();
      expect(dialog.closest('.MuiPopover-root')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Got it' })).toBeTruthy();
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('is hidden on the first open of a baby on this device', async () => {
    await seedNow(db);
    await seedMorning(db, 200);
    await putEvent(
      db,
      'diaper',
      90,
      90,
      { content: 'WET' },
      { createdBy: 'u-ana', createdAt: minutesAgo(60) },
    );
    renderNow();
    await screen.findByRole('button', { name: /^Diaper/ });
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('is hidden when nobody else logged anything since the last look', async () => {
    await seedNow(db);
    await seedMorning(db, 200);
    writeLastSeenAt(BABY.id, minutesAgo(180));
    renderNow();
    await screen.findByRole('button', { name: /^Diaper/ });
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('is offered to a Viewer as the card was (read only, Got it included)', async () => {
    await seedHandover({ role: 'Viewer' });
    renderNow({ baby: { ...BABY, role: 'Viewer' } });
    const sheet = await openCatchUp();
    expect(within(sheet).getByRole('button', { name: 'Got it' })).toBeTruthy();
  });

  it('is not offered in the Night view (as the card was not)', async () => {
    startNightView();
    stubWakeLock();
    await seedHandover();
    renderNow();
    await screen.findByRole('region', { name: 'Night view' });
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seedHandover();
    renderNow();
    const button = await screen.findByRole('button', {
      name: 'O que mudou desde a sua última olhada, 4 novos',
    });
    button.focus();
    fireEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Desde a sua última olhada' });
    expect(within(sheet).getByRole('button', { name: 'Entendi' })).toBeTruthy();
  });
});

describe('night layout', () => {
  it('shows three giant buttons and a state line, and keeps the screen awake', async () => {
    startNightView();
    const { request } = stubWakeLock();
    await seedNow(db);
    await seedMorning(db, 700);
    await putEvent(db, 'sleep', 252, null, { kind: 'night' });
    renderNow();

    const night = await screen.findByRole('region', { name: 'Night view' });
    expect(within(night).getByText('Asleep · Night')).toBeTruthy();
    const feed = within(night).getByRole('button', { name: /^Feed/ });
    const diaper = within(night).getByRole('button', { name: /^Diaper/ });
    const sleep = within(night).getByRole('button', { name: 'Night waking' });
    // Giant targets: at least 64 px high (the design asks for 64 px minimum at night).
    for (const button of [feed, diaper, sleep]) {
      expect(parseInt(getComputedStyle(button).minHeight, 10)).toBeGreaterThanOrEqual(64);
    }
    // No cards, tiles or charts: the day layout is gone.
    expect(screen.queryByRole('region', { name: 'Quick log' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Current state' })).toBeNull();
    expect(within(night).getByText('The screen stays on while this view is open.')).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
  });

  it('releases the wake lock when the view closes and asks again when the page returns', async () => {
    startNightView();
    const { request, sentinel } = stubWakeLock();
    await seedNow(db);
    await seedMorning(db, 700);
    const { unmount } = renderNow();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    sentinel.released = true;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    unmount();
    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('works without the Wake Lock API, and a refused request is ignored', async () => {
    startNightView();
    await seedNow(db);
    await seedMorning(db, 700);
    const first = renderNow();
    expect(await screen.findByRole('region', { name: 'Night view' })).toBeTruthy();
    expect(screen.queryByText('The screen stays on while this view is open.')).toBeNull();
    first.unmount();

    const request = vi.fn(async () => {
      throw new DOMException('refused', 'NotAllowedError');
    });
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    renderNow();
    expect(await screen.findByRole('region', { name: 'Night view' })).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalled());
  });

  it('Feed and Diaper open their trays from the giant buttons, and the sleep button logs', async () => {
    startNightView();
    stubWakeLock();
    await seedNow(db);
    await seedMorning(db, 100);
    renderNow();

    const night = await screen.findByRole('region', { name: 'Night view' });
    fireEvent.click(within(night).getByRole('button', { name: /^Diaper/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Wet' }));
    expect(await screen.findByText('Diaper logged, Wet')).toBeTruthy();

    fireEvent.click(within(night).getByRole('button', { name: 'Fell asleep' }));
    expect(await screen.findByText(/^(Nap|Night sleep) from/)).toBeTruthy();
  });

  it('shows the live nursing timers in the night view too', async () => {
    startNightView();
    stubWakeLock();
    await seedNow(db);
    await seedMorning(db, 100);
    await putEvent(db, 'feeding', 6, null, {
      method: 'breast',
      side: 'left',
      side_since: minutesAgo(6),
    });
    renderNow();
    expect(await screen.findByRole('region', { name: 'Nursing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
  });
});

describe('Portuguese (pt-BR)', () => {
  beforeEach(async () => {
    await useTestLocale('pt-BR');
  });

  it('translates the state card, the nap window, the tiles and the toast', async () => {
    // Early afternoon: a sleep started now is a nap, whatever time the suite runs at.
    pinClock(14);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow({ predictions: sleepPredictions(-5) });

    expect(await screen.findByText('Acordado')).toBeTruthy();
    expect(await screen.findByText('Janela da soneca')).toBeTruthy();
    expect(screen.getByText(/aberta agora/)).toBeTruthy();
    expect(screen.getByText('Confiança média')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Por quê?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hora de dormir' })).toBeTruthy();
    for (const name of [/^Mamada/, /^Fralda/, /^Remédios/, /^Mais/]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByText('Registro rápido')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Fralda/ }));
    const tray = await screen.findByRole('dialog', { name: 'Fralda' });
    fireEvent.click(within(tray).getByRole('button', { name: 'Xixi' }));
    expect(await screen.findByText('Fralda registrada, Xixi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Quando aconteceu' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Adormeceu' }));
    // The pill, and the middle of the day ring when it is open.
    expect((await screen.findAllByText('Dormindo · Soneca')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'Acordou' })).toBeTruthy();
  });

  it('translates the Why sheet', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow({ predictions: sleepPredictions(-5) });
    fireEvent.click(await screen.findByRole('button', { name: 'Por quê?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Por que essa janela?' });
    expect(within(sheet).getByText(/Em geral 1 h 45 min acordado depois de acordar/)).toBeTruthy();
    expect(within(sheet).getByText(/não são orientação médica/)).toBeTruthy();
  });

  it('translates the learning state', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow({ predictions: learningPredictions() });
    expect(await screen.findByText('Aprendendo o ritmo de Lia')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '1 de 3 sonos registrados' })).toBeTruthy();
  });

  it('translates the first-run screen', async () => {
    await seedNow(db);
    renderNow();
    expect(
      await screen.findByRole('heading', { name: 'Registre o primeiro evento de Lia' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Importar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Convidar' })).toBeTruthy();
  });

  it('translates nursing, the forgotten-timer note and the hand-over card', async () => {
    await seedNow(db);
    await seedMorning(db, 200);
    await putEvent(db, 'feeding', 6, null, {
      method: 'breast',
      side: 'right',
      side_since: minutesAgo(3),
    });
    await putEvent(db, 'tummy_time', 7 * 60, null, {});
    await putEvent(
      db,
      'diaper',
      90,
      90,
      { content: 'WET' },
      { createdBy: 'u-ana', createdAt: minutesAgo(60) },
    );
    writeLastSeenAt(BABY.id, minutesAgo(180));
    renderNow();

    const nursing = await screen.findByRole('region', { name: 'Amamentação' });
    expect(within(nursing).getByRole('button', { name: /^Esquerdo/ })).toBeTruthy();
    expect(within(nursing).getByRole('button', { name: 'Trocar lado' })).toBeTruthy();
    expect(within(nursing).getByRole('button', { name: 'Terminar' })).toBeTruthy();
    expect(await screen.findByText(/^Ainda em andamento\? .+ está há 7 h/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Parar às \d\d:\d\d$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ainda continua' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'O que mudou desde a sua última olhada, 1 novo' }),
    );
    const card = await screen.findByRole('dialog', { name: 'Desde a sua última olhada' });
    expect(within(card).getByText(/^Ana registrou 1 coisa desde/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Compartilhar como texto' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Entendi' })).toBeTruthy();
  });

  it('translates the night view', async () => {
    startNightView();
    stubWakeLock();
    await seedNow(db);
    await seedMorning(db, 700);
    await putEvent(db, 'sleep', 252, null, { kind: 'night' });
    renderNow();

    const night = await screen.findByRole('region', { name: 'Visual noturno' });
    expect(within(night).getByText('Dormindo · Noite')).toBeTruthy();
    expect(within(night).getByRole('button', { name: 'Despertar noturno' })).toBeTruthy();
    expect(
      within(night).getByText('A tela fica ligada enquanto esta tela está aberta.'),
    ).toBeTruthy();
  });
});

describe('accessibility (axe)', () => {
  async function violations() {
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      // jsdom has no layout or canvas, so contrast is checked by the token tests and by eye.
      rules: { 'color-contrast': { enabled: false } },
    });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
  }

  it.each(['light', 'dark', 'night'])('Now has no violations in the %s scheme', async (mode) => {
    if (mode === 'night') startNightView();
    else window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    if (mode === 'night') stubWakeLock();
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(
      db,
      'diaper',
      90,
      90,
      { content: 'WET' },
      { createdBy: 'u-ana', createdAt: minutesAgo(60) },
    );
    await putEvent(db, 'feeding', 6, null, {
      method: 'breast',
      side: 'right',
      side_since: minutesAgo(3),
    });
    await putEvent(db, 'tummy_time', 7 * 60, null, {});
    writeLastSeenAt(BABY.id, minutesAgo(180));
    renderNow({ predictions: sleepPredictions(-5) });

    if (mode === 'night') await screen.findByRole('region', { name: 'Night view' });
    else await screen.findByRole('button', { name: /^What changed since your last look/ });
    if (mode !== 'night') await screen.findByText('Nap window');
    expect(document.documentElement.hasAttribute(`data-${mode}`)).toBe(true);
    expect(await violations()).toEqual([]);
    if (mode === 'night') return;
    // The catch-up sheet, open.
    fireEvent.click(screen.getByRole('button', { name: /^What changed since your last look/ }));
    await screen.findByRole('dialog', { name: 'Since you last looked' });
    expect(await violations()).toEqual([]);
  });

  it('the first-run, learning and viewer screens have no violations', async () => {
    await seedNow(db, { role: 'Viewer' });
    const first = renderNow({ baby: { ...BABY, role: 'Viewer' } });
    await screen.findByText('Nothing has been logged yet.');
    expect(await violations()).toEqual([]);
    first.unmount();

    await seedMorning(db, 40);
    renderNow({ predictions: learningPredictions(), baby: { ...BABY, role: 'Viewer' } });
    await screen.findByText("Learning Lia's rhythm");
    expect(await violations()).toEqual([]);
  });

  it('an open tray and the Why sheet have no violations', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow({ predictions: sleepPredictions(-5) });

    fireEvent.click(await screen.findByRole('button', { name: /^Feed/ }));
    await screen.findByRole('dialog', { name: 'Feed' });
    expect(await violations()).toEqual([]);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Feed' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Feed' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    await screen.findByRole('dialog', { name: 'Why this window?' });
    expect(await violations()).toEqual([]);
  });
});
