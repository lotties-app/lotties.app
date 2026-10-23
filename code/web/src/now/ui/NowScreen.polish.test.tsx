import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { PredictionsDto } from '../../sync/contract';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import {
  BABY,
  learningPredictions,
  nowApi,
  pinClock,
  putEvent,
  seedMorning,
  seedNow,
  sleepPredictions,
} from './nowKit';
import { NowScreen } from './NowScreen';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { napWindowKey, readSkippedNap } from '../napGuidance';
import { readNowView, readRingOpen } from '../ringPrefs';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  await settleSync();
  await db.delete();
});

function renderNow(predictions: PredictionsDto | null = null) {
  const { api } = fakeApi(nowApi(predictions));
  return renderWithDb(db, <NowScreen baby={BABY} />, { api });
}

async function axeViolations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    // jsdom has no layout or canvas, so contrast is checked by the token tests and by eye.
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
}

/** Selects the colour scheme the next render starts in (night = the stored night-view override). */
function chooseScheme(mode: string) {
  if (mode === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }
}

const openNapSheet = async () =>
  fireEvent.click(
    await screen.findByRole('button', { name: /^Estimated nap \d\d:\d\d to \d\d:\d\d/ }),
  );

describe('the estimated nap sheet', () => {
  it('opens from the nap window with the window, the length and a calm line', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    await openNapSheet();

    const sheet = await screen.findByRole('dialog', { name: 'Estimated nap' });
    expect(within(sheet).getByTestId('nap-sheet-window').textContent).toMatch(
      /^\d\d:\d\d – \d\d:\d\d$/,
    );
    expect(within(sheet).getByText('about 1h 15m')).toBeTruthy();
    expect(
      within(sheet).getByText(/^A good moment to start winding down around \d\d:\d\d$/),
    ).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Log nap now' })).toBeTruthy();
  });

  it('says so when the window is open now', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(-5));
    await openNapSheet();
    const sheet = await screen.findByRole('dialog', { name: 'Estimated nap' });
    expect(within(sheet).getByText('The window is open now.')).toBeTruthy();
  });

  it('Log nap now starts the nap timer and closes the sheet', async () => {
    // Early afternoon: a sleep started now is a nap, whatever time the suite runs at.
    pinClock(14, 12);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(-5));
    await openNapSheet();
    const sheet = await screen.findByRole('dialog', { name: 'Estimated nap' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Log nap now' }));

    await waitFor(async () => {
      const running = (await db.events.toArray()).filter((e) => e.endedAt === null);
      expect(running).toHaveLength(1);
      expect(running[0].payload).toMatchObject({ kind: 'nap' });
    });
    // The pill, and the middle of the day ring when it is open.
    expect((await screen.findAllByText('Asleep · Nap')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Estimated nap' })).toBeNull());
  });

  it('Skip hides that prediction until the next one, and Show again brings it back', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const predictions = sleepPredictions(-5);
    renderNow(predictions);
    await openNapSheet();
    const sheet = await screen.findByRole('dialog', { name: 'Estimated nap' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Skip' }));

    expect(await screen.findByText('Estimated nap skipped')).toBeTruthy();
    expect(screen.queryByText('Nap window')).toBeNull();
    const next = predictions.predictions[0].nextStart!;
    expect(readSkippedNap(BABY.id)).toBe(napWindowKey(next));

    fireEvent.click(screen.getByRole('button', { name: 'Show again' }));
    expect(await screen.findByText('Nap window')).toBeTruthy();
    expect(readSkippedNap(BABY.id)).toBeNull();
  });

  it('a new prediction is not skipped', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    window.localStorage.setItem(`baby-routine.nap-skipped.${BABY.id}`, 'an|older-window');
    renderNow(sleepPredictions(-5));
    expect(await screen.findByText('Nap window')).toBeTruthy();
  });
});

describe('the day rhythm view', () => {
  // The ring draws today only: a morning seeded relative to now (and a nap window 40 minutes ahead)
  // must stay inside the same calendar day, whatever hour the suite runs at.
  beforeEach(() => pinClock(14));

  it('shows the ruler by default and the ring after choosing it, remembered', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    expect(await screen.findByTestId('ruler-now')).toBeTruthy();
    expect(screen.queryByTestId('day-ring')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ring' }));
    const ring = await screen.findByTestId('day-ring');
    expect(readNowView()).toBe('ring');
    expect(screen.queryByTestId('ruler-now')).toBeNull();
    // A text equivalent for the picture: the state, the sleep so far and the predicted window.
    const image = within(ring).getByRole('group', { name: /^Day rhythm/ });
    expect(image.getAttribute('aria-label')).toMatch(/^Day rhythm\. Awake 1h 52m\./);
    expect(image.getAttribute('aria-label')).toMatch(/Next nap window \d\d:\d\d to \d\d:\d\d\./);
    expect(within(ring).getByTestId('ring-now')).toBeTruthy();
    expect(within(ring).getAllByTestId('ring-window').length).toBeGreaterThan(0);
    expect(within(ring).getByTestId('ring-window-line').textContent).toMatch(/^Next nap about /);
    expect(within(ring).getByRole('list', { name: 'What the ring shows' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ruler' }));
    expect(await screen.findByTestId('ruler-now')).toBeTruthy();
    expect(readNowView()).toBe('ruler');
  });

  it('opens on the ring when it was the last choice', async () => {
    window.localStorage.setItem('baby-routine.now-view', 'ring');
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    expect(await screen.findByTestId('day-ring')).toBeTruthy();
  });

  it('draws the sleep of today and the duration in the middle while asleep', async () => {
    window.localStorage.setItem('baby-routine.now-view', 'ring');
    await seedNow(db);
    await seedMorning(db, 400);
    await putEvent(db, 'sleep', 42, null, { kind: 'nap' });
    renderNow();
    const ring = await screen.findByTestId('day-ring');
    expect(within(ring).getAllByTestId('ring-span-nap').length).toBeGreaterThan(0);
    expect(within(ring).getByText('Asleep · Nap')).toBeTruthy();
  });

  it('shows the ring when there is no nap window to put on the ruler, and folds it', async () => {
    await seedNow(db);
    await seedMorning(db, 40);
    renderNow(learningPredictions());
    expect(await screen.findByText("Learning Lia's rhythm")).toBeTruthy();
    const ring = await screen.findByTestId('day-ring');
    expect(within(ring).queryByTestId('ring-window')).toBeNull();
    expect(within(ring).getByText('Awake')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Hide the ring' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByTestId('day-ring')).toBeNull());
    expect(readRingOpen()).toBe(false);
  });

  it('shows the ring while asleep (no ruler then)', async () => {
    await seedNow(db);
    await seedMorning(db, 400);
    await putEvent(db, 'sleep', 42, null, { kind: 'nap' });
    renderNow();
    expect(await screen.findByTestId('day-ring')).toBeTruthy();
    expect(screen.queryByTestId('ruler-now')).toBeNull();
  });
});

const art = (container: ParentNode, name: string) =>
  container.querySelector(`svg[data-illustration="${name}"]`);

describe('illustrations on the Now screen', () => {
  it('draws the state of the baby as the hero and the tiles with their own drawings', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    const card = await screen.findByRole('region', { name: 'Current state' });
    expect(art(card, 'woke_up')).toBeTruthy();
    // Compact hero: 64 px since the "Running now" layout.
    expect(card.querySelector('svg[data-illustration="woke_up"]')?.getAttribute('width')).toBe(
      '64',
    );
    const tiles = screen.getByRole('region', { name: 'Quick log' });
    for (const name of ['bottle', 'diaper', 'medication', 'custom']) {
      expect(art(tiles, name), name).toBeTruthy();
    }
  });

  it('draws the nap while asleep in a nap, and the night in the night sleep', async () => {
    await seedNow(db);
    await seedMorning(db, 400);
    await putEvent(db, 'sleep', 42, null, { kind: 'nap' });
    const first = renderNow();
    const card = await screen.findByRole('region', { name: 'Current state' });
    expect(art(card, 'nap')).toBeTruthy();
    first.unmount();
    await db.events.clear();
    await seedMorning(db, 700);
    await putEvent(db, 'sleep', 250, null, { kind: 'night' });
    renderNow();
    expect(art(await screen.findByRole('region', { name: 'Current state' }), 'night')).toBeTruthy();
  });

  it('puts the drawing of what was logged on the toast', async () => {
    // Early afternoon: a sleep started now is a nap, whatever time the suite runs at.
    pinClock(14);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    fireEvent.click(await screen.findByRole('button', { name: 'Fell asleep' }));
    const toast = await screen.findByTestId('quick-log-toast');
    expect(art(toast, 'nap')).toBeTruthy();
  });

  it('draws every preset of the More sheet with its own illustration', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    fireEvent.click(await screen.findByRole('button', { name: /^More/ }));
    const grid = await screen.findByTestId('more-grid');
    // The tiles show once the sheet has worked out its order (one local read).
    await within(grid).findAllByRole('button');
    const names = Array.from(grid.querySelectorAll('svg[data-illustration]'), (svg) =>
      svg.getAttribute('data-illustration'),
    );
    expect(names).toEqual(
      expect.arrayContaining(['woke_up', 'nap', 'bedtime', 'fell_asleep', 'night_waking']),
    );
    expect(names).toEqual(
      expect.arrayContaining(['bottle', 'nursing', 'diaper', 'medication', 'belly_pain']),
    );
    expect(names).toEqual(expect.arrayContaining(['bath', 'tummy_time', 'custom']));
  });

  it('draws the tray header and the nursing card', async () => {
    await seedNow(db);
    await seedMorning(db, 95);
    await putEvent(db, 'feeding', 6, null, { method: 'breast', side: 'right' });
    renderNow(sleepPredictions(40));
    const nursing = await screen.findByRole('region', { name: 'Nursing' });
    expect(art(nursing, 'nursing')).toBeTruthy();
  });

  it('draws the first-run choices and a hero before anything is logged', async () => {
    await seedNow(db);
    renderNow();
    const first = await screen.findByRole('region', { name: "Log Lia's first event" });
    expect(art(first, 'woke_up')).toBeTruthy();
    expect(art(first, 'fell_asleep')).toBeTruthy();
    expect(art(first, 'bottle')).toBeTruthy();
  });

  it('draws the forgotten timer notice small beside its text', async () => {
    await seedNow(db);
    await seedMorning(db, 400);
    await putEvent(db, 'sleep', 300, null, { kind: 'nap' });
    renderNow();
    const notice = await screen.findByRole('group', { name: /^Still asleep\?/ });
    expect(art(notice, 'nap')?.getAttribute('width')).toBe('32');
  });
});

describe('the night sky', () => {
  it('is a decorative, static layer behind the Now screen that only the night scheme shows', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    const sky = await screen.findByTestId('night-stars');
    expect(sky.getAttribute('aria-hidden')).toBe('true');
    const css = Array.from(document.querySelectorAll('style'), (node) => node.textContent).join('');
    // Night only, tiny dots at low opacity, nothing animated, dropped for less data/transparency.
    expect(css).toContain('[data-night] .');
    expect(css).toContain('prefers-reduced-data');
    expect(css).toContain('prefers-reduced-transparency');
    expect(css).toContain('radial-gradient(');
    expect(css).not.toMatch(/animation[^;]*night-stars/);
  });
});

describe('accessibility (axe)', () => {
  it.each(['light', 'dark'])(
    'the ring, the nap sheet and the More sheet are clean in %s',
    async (mode) => {
      chooseScheme(mode);
      window.localStorage.setItem('baby-routine.now-view', 'ring');
      await seedNow(db);
      await seedMorning(db, 112);
      renderNow(sleepPredictions(40));
      await screen.findByTestId('day-ring');
      expect(await axeViolations()).toEqual([]);

      await openNapSheet();
      await screen.findByRole('dialog', { name: 'Estimated nap' });
      expect(await axeViolations()).toEqual([]);
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Estimated nap' }), { key: 'Escape' });
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Estimated nap' })).toBeNull(),
      );

      fireEvent.click(screen.getByRole('button', { name: /^More/ }));
      await screen.findByRole('dialog', { name: 'More' });
      expect(await axeViolations()).toEqual([]);
    },
  );

  it('the night view with its sky is clean', async () => {
    chooseScheme('night');
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(sleepPredictions(40));
    await screen.findByRole('region', { name: 'Night view' });
    expect(document.documentElement.hasAttribute('data-night')).toBe(true);
    expect(await axeViolations()).toEqual([]);
  });
});
