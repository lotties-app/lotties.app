import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby, BabyRole } from '../../db/models';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { setUnitSetting } from '../../units/state';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { BABY, nowApi, pinClock, putEvent, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The "Milk today" card on Now: part of the Today section at the end of the screen, full width
 * under the Today tiles (the quick log, cry entry and state card keep their places); the drunk number is the Feeds note's; hidden without a finished bottle amount, at night and on
 * the first run; shown to everyone who sees the Today strip.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  window.localStorage.clear();
  setUnitSetting('metric');
  pinClock(14);
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  setUnitSetting('auto');
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

async function renderNow(role: BabyRole = 'Owner') {
  const baby: Baby = { ...BABY, role, userId: 'u-me' };
  await seedNow(db, { role });
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={baby} />, { api });
}

async function seedBottles() {
  await putEvent(db, 'feeding', 300, 280, {
    method: 'bottle',
    amount_ml: 150,
    amount_drunk_ml: 90,
  });
  await putEvent(db, 'feeding', 180, 170, { method: 'bottle', amount_ml: 120 });
  await putEvent(db, 'feeding', 120, 100, { method: 'breast' });
  // Running: counts in neither number.
  await putEvent(db, 'feeding', 5, null, { method: 'bottle', amount_ml: 200 });
}

const isBefore = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const terms = (region: HTMLElement) =>
  within(region)
    .getAllByRole('term')
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);

describe('Milk today on Now', () => {
  it('sits in the Today section under its tiles, after the state card', async () => {
    await seedBottles();
    await renderNow();
    const today = await screen.findByRole('region', { name: 'Today' });
    const milk = within(today).getByRole('region', { name: 'Milk today' });
    const tiles = screen.getByRole('region', { name: 'Quick log' });
    const cry = screen.getByRole('button', { name: /crying/i });
    const state = screen.getByRole('region', { name: 'Current state' });
    expect(isBefore(tiles, cry)).toBe(true);
    expect(isBefore(cry, state)).toBe(true);
    expect(isBefore(state, milk)).toBe(true);
    const feeds = within(today).getByText('Feeds');
    expect(isBefore(feeds, milk)).toBe(true);
    expect(within(today).getByRole('heading', { name: 'Today' }).tagName).toBe('H2');
    expect(within(milk).getByRole('heading', { name: 'Milk today' }).tagName).toBe('H3');
    expect(terms(milk)).toEqual([
      ['drunk', '210 ml'],
      ['prepared', '270 ml'],
    ]);
    expect(within(milk).getByText('Not drunk: 60 ml')).toBeTruthy();
  });

  it('shows the same drunk number as the Feeds note of the Today strip', async () => {
    await seedBottles();
    await renderNow();
    const milk = await screen.findByRole('region', { name: 'Milk today' });
    const strip = screen.getByRole('region', { name: 'Today' });
    const note = within(strip).getByRole('definition', { name: /drunk from bottles/ });
    expect(note.textContent).toBe('210 ml');
    expect(terms(milk)[0]).toEqual(['drunk', note.textContent]);
  });

  it('is hidden when no finished bottle of today has an amount', async () => {
    await putEvent(db, 'feeding', 120, 100, { method: 'breast' });
    await putEvent(db, 'feeding', 90, 85, { method: 'bottle' });
    await putEvent(db, 'feeding', 5, null, { method: 'bottle', amount_ml: 200 });
    await renderNow();
    await screen.findByRole('region', { name: 'Current state' });
    expect(screen.queryByRole('region', { name: 'Milk today' })).toBeNull();
  });

  it('is not on the first run (nothing logged)', async () => {
    await renderNow();
    await screen.findByRole('heading', { name: 'Now' });
    expect(screen.queryByRole('region', { name: 'Milk today' })).toBeNull();
  });

  it('is not in the night view', async () => {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
    await seedBottles();
    await putEvent(db, 'sleep', 60, null, { kind: 'night' });
    await renderNow();
    await screen.findByRole('region', { name: 'Night view' });
    expect(screen.queryByRole('region', { name: 'Milk today' })).toBeNull();
  });

  it.each(['Viewer', 'Caregiver'] as const)(
    'is shown to a %s, like the Today strip',
    async (role) => {
      await seedBottles();
      await renderNow(role);
      expect(await screen.findByRole('region', { name: 'Milk today' })).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Today' })).toBeTruthy();
    },
  );
});
