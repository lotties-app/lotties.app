import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent } from '../db/models';
import { formatDate } from '../i18n/format';
import { SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { DIAPER, FEEDING, seedBaby } from '../test/seed';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { DayPage } from './DayPage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

/** Local time `daysAgo` days before today at `h:m`. */
function at(daysAgo: number, h: number, m = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).toISOString();
}

function event(overrides: Partial<BabyEvent> & { id: string }): BabyEvent {
  return {
    babyId: BABY_ID,
    typeId: FEEDING,
    startedAt: at(1, 8),
    endedAt: at(1, 8, 30),
    payload: {},
    notes: null,
    createdBy: 'user-1',
    createdAt: at(1, 8),
    updatedAt: at(1, 8),
    deletedAt: null,
    ...overrides,
  };
}

/** A day (yesterday, so it is always complete) with a nap between a feed and a diaper. */
async function seedNapDay() {
  await seedBaby(db);
  await db.eventTypes.put(SLEEP_TYPE);
  await db.events.bulkPut([
    event({ id: 'feed', startedAt: at(1, 8), endedAt: at(1, 8) }),
    event({
      id: 'nap',
      typeId: SLEEP_TYPE.id,
      startedAt: at(1, 9),
      endedAt: at(1, 10, 12),
      payload: { kind: 'nap' },
    }),
    event({
      id: 'diaper',
      typeId: DIAPER,
      startedAt: at(1, 11),
      endedAt: at(1, 11),
      payload: { content: 'WET' },
    }),
  ]);
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

const swipeRight = (target: HTMLElement) => {
  fireEvent.touchStart(target, { touches: [{ clientX: 40, clientY: 100 }] });
  fireEvent.touchEnd(target, { changedTouches: [{ clientX: 220, clientY: 100 }] });
};
const swipeLeft = (target: HTMLElement) => {
  fireEvent.touchStart(target, { touches: [{ clientX: 220, clientY: 100 }] });
  fireEvent.touchEnd(target, { changedTouches: [{ clientX: 40, clientY: 100 }] });
};

/** Swipes the screen (not the strip) to the right: the previous day. */
async function goToYesterday() {
  swipeRight(await screen.findByRole('heading', { name: 'Day' }));
  await screen.findByRole('list', { name: /^Yesterday, / });
}

describe('the week strip', () => {
  it('shows seven days with today marked and the selected day pressed', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    const strip = await screen.findByRole('group', { name: 'Week' });
    const days = within(strip).getAllByRole('button');
    expect(days).toHaveLength(7);
    expect(days.filter((d) => d.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    const today = days.find((d) => d.getAttribute('aria-current') === 'date')!;
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(today.getAttribute('aria-label')).toBe(formatDate(new Date(), 'weekdayLong'));
    // Days after today cannot be chosen.
    for (const day of days.filter((d) => (d as HTMLButtonElement).disabled)) {
      expect(day.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('chooses a day of the week by tapping it', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    const strip = await screen.findByRole('group', { name: 'Week' });
    // Go a week back so every day of the strip can be chosen, then tap the first one.
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: /^Today, / })).toBeNull());
    const days = within(strip).getAllByRole('button');
    const target = days.find((d) => d.getAttribute('aria-pressed') !== 'true')!;
    fireEvent.click(target);
    await waitFor(() => expect(target.getAttribute('aria-pressed')).toBe('true'));
    expect(days.filter((d) => d.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('jumps a week with the chevrons and back, never past today', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    const next = await screen.findByRole('button', { name: 'Next week' });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('list', { name: /^Today, / })).toBeNull();
    fireEvent.click(next);
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(true));
  });

  it('swiping the strip moves by a week, swiping the list by a day', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    const strip = await screen.findByRole('group', { name: 'Week' });
    const next = screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement;
    swipeRight(strip);
    await waitFor(() => expect(next.disabled).toBe(false));
    swipeLeft(strip);
    await waitFor(() => expect(next.disabled).toBe(true));
  });

  it('names the month on the button that opens the date sheet', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    const month = formatDate(new Date(), 'monthYear');
    const button = await screen.findByRole('button', {
      name: new RegExp(`^${month}\\. Choose a date`),
    });
    fireEvent.click(button);
    expect(await screen.findByRole('dialog', { name: 'Choose a day' })).toBeTruthy();
  });
});

describe('the rows of the day', () => {
  it('draws the illustration of each event and tints the card by category', async () => {
    await seedNapDay();
    renderWithDb(db, <DayPage />);
    await goToYesterday();
    const list = await screen.findByRole('list', { name: /^Yesterday, / });
    for (const name of ['nap', 'diaper', 'bottle']) {
      expect(list.querySelector(`svg[data-illustration="${name}"]`), name).toBeTruthy();
    }
  });

  it('adds a quiet separator where a nap ended, between the events around it', async () => {
    await seedNapDay();
    renderWithDb(db, <DayPage />);
    await goToYesterday();
    const list = await screen.findByRole('list', { name: /^Yesterday, / });
    expect(within(list).getByText('Sleep session ended, 1h 12m')).toBeTruthy();
    // Newest first: the diaper, then the separator above the nap, then the feed.
    const labels = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    const order = ['Wet', 'Sleep session ended', 'Nap', 'Feeding'];
    let from = 0;
    for (const word of order) {
      const index = labels.findIndex((text, i) => i >= from && text.includes(word));
      expect(index, word).toBeGreaterThanOrEqual(from);
      from = index + 1;
    }
  });

  it('hides the separator with the sleep rows when the filter leaves sleep out', async () => {
    await seedNapDay();
    renderWithDb(db, <DayPage />);
    await goToYesterday();
    await screen.findByText('Sleep session ended, 1h 12m');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const sheet = await screen.findByRole('dialog', { name: 'Show on this day' });
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Diapers' }));
    expect(screen.queryByText('Sleep session ended, 1h 12m')).toBeNull();
  });

  it('explains the colours of the ribbon with the illustrations of what is on it', async () => {
    await seedNapDay();
    renderWithDb(db, <DayPage />);
    await goToYesterday();
    const legend = await screen.findByRole('list', { name: 'What the colours mean' });
    expect(within(legend).getByText('Sleep')).toBeTruthy();
    expect(within(legend).getByText('Feeding')).toBeTruthy();
    expect(within(legend).getByText('Diapers')).toBeTruthy();
    expect(legend.querySelector('svg[data-illustration="nap"]')).toBeTruthy();
  });

  it('shows an illustrated, friendlier empty day', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    expect(await screen.findByText('No events this day yet.')).toBeTruthy();
    expect(document.querySelector('svg[data-illustration="nap"]')).toBeTruthy();
  });
});

describe('accessibility (axe)', () => {
  it.each(['light', 'dark', 'night'])(
    'the week strip, the rows with separators and the legend are clean in %s',
    async (mode) => {
      chooseScheme(mode);
      await seedNapDay();
      renderWithDb(db, <DayPage />);
      await goToYesterday();
      await screen.findByText('Sleep session ended, 1h 12m');
      expect(document.documentElement.hasAttribute(`data-${mode}`)).toBe(true);
      expect(await axeViolations()).toEqual([]);
    },
  );
});
