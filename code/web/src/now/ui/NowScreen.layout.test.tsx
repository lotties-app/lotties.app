import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import type { PredictionsDto } from '../../sync/contract';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { readRingOpen } from '../ringPrefs';
import { BABY, nowApi, pinClock, putEvent, seedMorning, seedNow, sleepPredictions } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The "Running now" layout of Now (docs/DESIGN.md, Now): what you act on comes first. Running
 * timers as cards, then Quick log, then the compact state card with the folding day ring, then the
 * suggestion cards and Today.
 */

let db: BabyRoutineDb;
const VIEWPORT = { width: window.innerWidth, height: window.innerHeight };

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setViewport(VIEWPORT.width, VIEWPORT.height);
  await settleSync();
  await db.delete();
});

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function renderNow(baby: Baby = BABY, predictions: PredictionsDto | null = null) {
  const { api } = fakeApi(nowApi(predictions));
  return renderWithDb(db, <NowScreen baby={baby} />, { api });
}

const follows = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const startBottle = () => putEvent(db, 'feeding', 6, null, { method: 'bottle', amount_ml: 120 });

describe('the order of the Now screen', () => {
  it('puts Running now first, then Quick log, then the state card, then the suggestions', async () => {
    pinClock(14);
    await seedNow(db);
    await seedMorning(db, 112);
    await startBottle();
    renderNow(BABY, sleepPredictions(40));

    const running = await screen.findByRole('region', { name: 'Running timers' });
    const quickLog = screen.getByRole('region', { name: 'Quick log' });
    const state = screen.getByRole('region', { name: 'Current state' });
    const today = await screen.findByRole('region', { name: /today/i });
    expect(follows(running, quickLog)).toBe(true);
    expect(follows(quickLog, state)).toBe(true);
    expect(follows(state, today)).toBe(true);
    expect(within(running).getByRole('heading', { name: 'Running now' })).toBeTruthy();
    expect(within(quickLog).getByRole('heading', { name: 'Quick log' })).toBeTruthy();
  });

  it('shows the bottle with what matters, a large live time and big Pause and Stop', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const bottle = await startBottle();
    renderNow();

    const card = await screen.findByRole('article', { name: 'Bottle' });
    expect(within(card).getByTestId('running-title').textContent).toBe('Bottle · 120 ml');
    expect(within(card).getByTestId('running-elapsed').textContent).toMatch(/^0[67]:\d\d$/);
    const pause = within(card).getByRole('button', { name: 'Pause Bottle' });
    const stop = within(card).getByRole('button', { name: 'Stop Bottle' });
    expect(pause).toBeTruthy();
    expect(stop).toBeTruthy();

    fireEvent.click(pause);
    await waitFor(async () =>
      expect((await db.events.get(bottle.id))?.payload.paused_at).toEqual(expect.any(String)),
    );
    expect(await within(card).findByRole('button', { name: 'Resume Bottle' })).toBeTruthy();
    expect(card.getAttribute('data-paused')).toBe('true');
    expect(within(card).getByTestId('timer-paused')).toBeTruthy();
  });

  it('stops a timer from its card', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const tummy = await putEvent(db, 'tummy_time', 5, null, {});
    renderNow();
    const card = await screen.findByRole('article', { name: 'Tummy time' });
    fireEvent.click(within(card).getByRole('button', { name: 'Stop Tummy time' }));
    await waitFor(async () => expect((await db.events.get(tummy.id))?.endedAt).not.toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull(),
    );
  });

  it('opens the timer sheet from the top of a card', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(db, 'tummy_time', 5, null, {});
    renderNow();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the Tummy time timer' }));
    const sheet = await screen.findByRole('dialog', { name: 'Tummy time' });
    expect(within(sheet).getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  it('stacks the timers, the main one first, three at most and then "N more"', async () => {
    pinClock(14);
    await seedNow(db);
    await seedMorning(db, 400);
    await putEvent(db, 'tummy_time', 20, null, {});
    await putEvent(db, 'bath', 15, null, {});
    await startBottle();
    await putEvent(db, 'sleep', 10, null, { kind: 'nap' });
    renderNow();

    const running = await screen.findByRole('region', { name: 'Running timers' });
    const names = () =>
      within(running)
        .getAllByRole('article')
        .map((card) => card.getAttribute('aria-label'));
    // A sleep comes first even though it started last; the others oldest first.
    expect(names()).toEqual(['Nap', 'Tummy time', 'Bath']);
    const more = within(running).getByRole('button', { name: '1 more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(names()).toEqual(['Nap', 'Tummy time', 'Bath', 'Bottle']);
    const fewer = within(running).getByRole('button', { name: 'Show fewer' });
    expect(fewer.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows nothing of Running now when no timer runs', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();
    await screen.findByRole('region', { name: 'Quick log' });
    expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull();
  });
});

describe('roles', () => {
  it('a viewer sees the running timers without Pause or Stop', async () => {
    await seedNow(db, { role: 'Viewer' });
    await seedMorning(db, 112);
    await startBottle();
    renderNow({ ...BABY, role: 'Viewer' });
    const card = await screen.findByRole('article', { name: 'Bottle' });
    expect(within(card).getByTestId('running-elapsed')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /^(Pause|Stop) / })).toBeNull();
  });

  it('a viewer follows a nursing session without its controls', async () => {
    await seedNow(db, { role: 'Viewer' });
    await seedMorning(db, 112);
    await putEvent(db, 'feeding', 6, null, { method: 'breast', side: 'left' });
    renderNow({ ...BABY, role: 'Viewer' });
    const card = await screen.findByRole('region', { name: 'Nursing' });
    expect(within(card).getByTestId('nursing-total')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Switch side' })).toBeNull();
  });
});

describe('the folding day ring', () => {
  it('starts open on a tall, wide enough screen', async () => {
    setViewport(430, 932);
    pinClock(14);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(BABY, sleepPredictions(40));
    expect(await screen.findByTestId('ruler-now')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Hide the ring' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it.each([
    ['short', 390, 700],
    ['narrow', 360, 800],
  ])('starts folded on a %s screen and opens on demand, remembered', async (_, width, height) => {
    setViewport(width, height);
    pinClock(14);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(BABY, sleepPredictions(40));
    const toggle = await screen.findByRole('button', { name: 'Show the ring' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('ruler-now')).toBeNull();
    // The window line stays in the card while the ring is folded.
    expect(screen.getByText('Nap window')).toBeTruthy();
    fireEvent.click(toggle);
    expect(await screen.findByTestId('ruler-now')).toBeTruthy();
    expect(readRingOpen()).toBe(true);
    // The view toggle lives inside the folding part.
    expect(screen.getByRole('group', { name: 'Day view' })).toBeTruthy();
  });

  it('keeps the choice of the device over the default', async () => {
    setViewport(430, 932);
    window.localStorage.setItem('baby-routine.now-ring-open', 'closed');
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow(BABY, sleepPredictions(40));
    expect(await screen.findByRole('button', { name: 'Show the ring' })).toBeTruthy();
    expect(screen.queryByTestId('ruler-now')).toBeNull();
  });

  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRingOpen()).toBe(true);
    setViewport(360, 640);
    expect(readRingOpen()).toBe(false);
  });
});

describe('accessibility (axe)', () => {
  it.each(['light', 'dark'])('two running timers, one paused, are clean in %s', async (mode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    await seedNow(db);
    await seedMorning(db, 112);
    await startBottle();
    await putEvent(db, 'tummy_time', 9, null, { paused_at: new Date().toISOString() });
    renderNow(BABY, sleepPredictions(40));
    await screen.findByRole('article', { name: 'Tummy time' });
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`),
    ).toEqual([]);
  });
});

describe('in Portuguese', () => {
  it('names the sections and the ring toggle in pt-BR', async () => {
    await useTestLocale('pt-BR');
    setViewport(360, 640);
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(db, 'tummy_time', 20, null, {});
    await putEvent(db, 'bath', 15, null, {});
    await startBottle();
    await putEvent(db, 'sleep', 10, null, { kind: 'nap' });
    renderNow(BABY, sleepPredictions(40));
    const running = await screen.findByRole('region', { name: 'Cronômetros em andamento' });
    expect(within(running).getByRole('heading', { name: 'Em andamento' })).toBeTruthy();
    expect(within(running).getByRole('button', { name: 'mais 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Registro rápido' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver anel' }));
    expect(await screen.findByRole('button', { name: 'Ocultar anel' })).toBeTruthy();
  });
});
