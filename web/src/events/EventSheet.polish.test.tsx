import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { seedBaby } from '../test/seed';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { EventSheet } from './EventSheet';

let db: BabyRoutineDb;

beforeEach(async () => {
  window.localStorage.clear();
  db = testDatabase();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await db.delete();
});

function renderSheet(props: Partial<Parameters<typeof EventSheet>[0]> = {}) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <EventSheet babyId={BABY_ID} types={[FEEDING_TYPE, SLEEP_TYPE]} onDone={onDone} {...props} />,
  );
  return onDone;
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

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const choose = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

describe('a bottle is a moment, not a timer', () => {
  it('has no "Still running" and no End once the method is a bottle', () => {
    renderSheet({ initialTypeId: FEEDING_TYPE.id });
    // Nothing chosen yet: it could still be nursing, so the timer is on.
    expect(screen.getByRole('switch', { name: 'Still running' })).toBeTruthy();
    choose('Bottle');
    expect(screen.queryByRole('switch', { name: 'Still running' })).toBeNull();
    expect(screen.queryByText('End')).toBeNull();
    expect(screen.getByText('Time')).toBeTruthy();
  });

  it('saves a bottle finished at the moment it started, never running', async () => {
    const onDone = renderSheet({ initialTypeId: FEEDING_TYPE.id });
    choose('Bottle');
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toMatchObject({ method: 'bottle' });
    expect(saved.endedAt).not.toBeNull();
    expect(saved.endedAt).toBe(saved.startedAt);
  });

  it('solid food is a moment too', () => {
    renderSheet({ initialTypeId: FEEDING_TYPE.id });
    choose('Solid food');
    expect(screen.queryByRole('switch', { name: 'Still running' })).toBeNull();
  });

  it('nursing starts a running timer and the switch comes back when the method changes', async () => {
    const onDone = renderSheet({ initialTypeId: FEEDING_TYPE.id });
    choose('Bottle');
    expect(screen.queryByRole('switch', { name: 'Still running' })).toBeNull();
    choose('Breast');
    const running = screen.getByRole('switch', { name: 'Still running' });
    expect(running.getAttribute('aria-checked')).toBe('true');
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.endedAt).toBeNull();
  });

  it('keeps the length of a finished bottle that was edited', async () => {
    const start = new Date(2026, 9, 20, 6, 0);
    const end = new Date(2026, 9, 20, 6, 20);
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      payload: { method: 'bottle' },
    });
    const onDone = renderSheet({ event });
    // A finished event with its own length shows both ends.
    expect(screen.getByText('End')).toBeTruthy();
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const saved = await db.events.get(event.id);
    expect(saved?.endedAt).toBe(end.toISOString());
  });
});

describe('the time panel of the sheet is one short row', () => {
  it('shows the quick chips and the time together, with the day and the ruler folded away', () => {
    renderSheet({ initialTypeId: FEEDING_TYPE.id });
    choose('Bottle');
    const chips = screen.getByRole('group', { name: 'Quick times' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['Now', '5 min ago', '15 min ago', '30 min ago']);
    expect(screen.queryByRole('group', { name: 'Day' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByRole('button', { name: /^Today/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: /^More precise/ })).toBeTruthy();
  });

  it('opens the ruler behind "More precise" and the day chips behind the day', () => {
    renderSheet({ initialTypeId: FEEDING_TYPE.id });
    choose('Bottle');
    fireEvent.click(screen.getByRole('button', { name: /^More precise/ }));
    expect(screen.getByRole('slider', { name: 'Adjust time' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Today/ }));
    const day = screen.getByRole('group', { name: 'Day' });
    fireEvent.click(within(day).getByRole('button', { name: 'Yesterday' }));
    // The folded button now names the new day, and the large time in the header follows.
    expect(screen.getAllByRole('button', { name: /^Yesterday/ })).toHaveLength(2);
    expect(within(screen.getByTestId('sheet-hero-time')).getByText('Yesterday')).toBeTruthy();
  });
});

describe('the hero of the sheet', () => {
  it('shows the illustration of the event and the start time as a large numeral with the day', () => {
    renderSheet({ initialTypeId: FEEDING_TYPE.id });
    const dialog = screen.getByRole('dialog', { name: 'Feeding' });
    expect(dialog.querySelector('svg[data-illustration="bottle"]')).toBeTruthy();
    choose('Breast');
    expect(dialog.querySelector('svg[data-illustration="nursing"]')).toBeTruthy();
    const time = screen.getByTestId('sheet-hero-time');
    expect(within(time).getByText(/^\d\d:\d\d$/)).toBeTruthy();
    expect(within(time).getByText('Today')).toBeTruthy();
  });

  it('moves focus to the time field when the large time is pressed', () => {
    renderSheet({ initialTypeId: FEEDING_TYPE.id });
    choose('Bottle');
    fireEvent.click(screen.getByTestId('sheet-hero-time'));
    expect(document.activeElement?.tagName).toBe('INPUT');
  });
});

describe('accessibility (axe)', () => {
  it.each(['light', 'dark', 'night'])(
    'the sheet with its hero and the folded time is clean in %s',
    async (mode) => {
      chooseScheme(mode);
      renderSheet({ initialTypeId: FEEDING_TYPE.id });
      choose('Bottle');
      fireEvent.click(screen.getByRole('button', { name: /^More precise/ }));
      expect(document.documentElement.hasAttribute(`data-${mode}`)).toBe(true);
      expect(await axeViolations()).toEqual([]);
    },
  );
});
