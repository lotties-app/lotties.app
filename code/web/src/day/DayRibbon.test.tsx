import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent } from '../db/models';
import { DayPage } from '../pages/DayPage';
import { SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb } from '../test/renderApp';
import { DIAPER, FEEDING, seedBaby } from '../test/seed';

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
    endedAt: at(1, 8),
    payload: {},
    notes: null,
    createdBy: 'user-1',
    createdAt: at(1, 8),
    updatedAt: at(1, 8),
    deletedAt: null,
    ...overrides,
  };
}

/** Yesterday (always complete): a bottle, a nap and a diaper; `extra` adds more. */
async function seedDay(extra: BabyEvent[] = []) {
  await seedBaby(db);
  await db.eventTypes.put(SLEEP_TYPE);
  await db.events.bulkPut([
    event({ id: 'feed', payload: { method: 'bottle', amount_ml: 120 } }),
    event({
      id: 'nap',
      typeId: SLEEP_TYPE.id,
      startedAt: at(1, 9),
      endedAt: at(1, 10, 12),
      payload: { kind: 'nap' },
    }),
    event({ id: 'wet', typeId: DIAPER, startedAt: at(1, 11), payload: { content: 'WET' } }),
    ...extra,
  ]);
}

/** Renders the Day page and swipes to yesterday; returns the ribbon. */
async function openYesterday() {
  renderWithDb(db, <DayPage />);
  const heading = await screen.findByRole('heading', { name: 'Day' });
  fireEvent.touchStart(heading, { touches: [{ clientX: 40, clientY: 100 }] });
  fireEvent.touchEnd(heading, { changedTouches: [{ clientX: 220, clientY: 100 }] });
  await screen.findByRole('list', { name: /^Yesterday, / });
  return screen.getByRole('group', { name: /^The day at a glance/ });
}

const ribbonButtons = (ribbon: HTMLElement) => within(ribbon).getAllByRole('button');

async function axeViolations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
}

describe('the day ribbon', () => {
  it('is a labelled group of named marks in time order; the strip counts the naps', async () => {
    await seedDay();
    const ribbon = await openYesterday();
    const names = ribbonButtons(ribbon).map((button) => button.getAttribute('aria-label'));
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^Feeding 08:00, Bottle/);
    expect(names[1]).toBe('Sleep 09:00 – 10:12, 1h 12m, Nap');
    expect(names[2]).toBe('Diaper 11:00, Wet');
    // The nap count sits under the sleep total of the strip, no second summary line.
    const strip = screen.getByRole('region', { name: 'Summary of the day' });
    expect(within(strip).getByText('1 nap')).toBeTruthy();
    expect(screen.queryByText(/of sleep ·/)).toBeNull();
    // Only today has a "now" line.
    expect(document.querySelector('[data-testid="ribbon-now"]')).toBeNull();
  });

  it('says on the nap row that she fell asleep during a bottle (derived, nothing stored on the nap)', async () => {
    await seedDay([
      event({
        id: 'interrupted',
        startedAt: at(1, 8, 40),
        endedAt: at(1, 9),
        payload: { method: 'bottle', amount_ml: 120, ended_by: 'sleep' },
      }),
    ]);
    await openYesterday();
    const list = screen.getByRole('list', { name: /^Yesterday, / });
    expect(within(list).getByText(/Fell asleep during a bottle/)).toBeTruthy();
    expect((await db.events.get('nap'))!.payload).toEqual({ kind: 'nap' });
  });

  it('opens the detail of a mark and closes it with Escape, giving the focus back', async () => {
    await seedDay();
    const ribbon = await openYesterday();
    const nap = within(ribbon).getByRole('button', { name: /^Sleep 09:00/ });
    nap.focus();
    fireEvent.click(nap);
    const detail = await screen.findByRole('dialog', { name: 'Nap' });
    expect(within(detail).getByText('09:00 – 10:12')).toBeTruthy();
    expect(within(detail).getByText(/1h 12m/)).toBeTruthy();
    expect(nap.getAttribute('aria-expanded')).toBe('true');
    expect(await axeViolations()).toEqual([]);
    fireEvent.keyDown(detail, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nap' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(nap));
  });

  it('anchors the detail to the mark in a popover on wider screens, without motion if asked', async () => {
    // A tablet or desktop window whose user prefers reduced motion.
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('min-width') || query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    try {
      await seedDay();
      const ribbon = await openYesterday();
      fireEvent.click(within(ribbon).getByRole('button', { name: /^Diaper 11:00/ }));
      const detail = await screen.findByRole('dialog', { name: 'Wet' });
      expect(detail.classList.contains('MuiPopover-paper')).toBe(true);
      expect(within(detail).getByRole('button', { name: 'Open' })).toBeTruthy();
      expect(await axeViolations()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens the event in the edit sheet from the detail', async () => {
    await seedDay();
    const ribbon = await openYesterday();
    fireEvent.click(within(ribbon).getByRole('button', { name: /^Diaper 11:00/ }));
    const detail = await screen.findByRole('dialog', { name: 'Wet' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Open' }));
    // The edit sheet is named by the event's type.
    expect(await screen.findByRole('dialog', { name: 'Diaper' })).toBeTruthy();
  });

  it('shows the event in the list: scrolls to its row, highlights it and focuses it', async () => {
    await seedDay();
    const ribbon = await openYesterday();
    fireEvent.click(within(ribbon).getByRole('button', { name: /^Diaper 11:00/ }));
    const detail = await screen.findByRole('dialog', { name: 'Wet' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Show in list' }));
    const row = screen.getByRole('button', { name: 'Edit Wet, 11:00' });
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.closest('[data-event-id]')?.getAttribute('data-event-id')).toBe('wet');
  });

  it('moves between marks with the arrow keys, Home and End (one tab stop)', async () => {
    await seedDay();
    const ribbon = await openYesterday();
    const buttons = ribbonButtons(ribbon);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: 'End' });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2], { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
    await waitFor(() => expect(buttons[0].tabIndex).toBe(0));
  });

  it('counts close events in one mark that lists them', async () => {
    await seedDay([
      event({
        id: 'dirty',
        typeId: DIAPER,
        startedAt: at(1, 11, 10),
        payload: { content: 'DIRTY' },
      }),
    ]);
    const ribbon = await openYesterday();
    const counted = within(ribbon).getByRole('button', { name: '2 events, 11:00 to 11:10' });
    fireEvent.click(counted);
    const detail = await screen.findByRole('dialog', { name: '2 events' });
    fireEvent.click(within(detail).getByRole('button', { name: /Dirty/ }));
    const single = await screen.findByRole('dialog', { name: 'Dirty' });
    expect(within(single).getByRole('button', { name: 'Show in list' })).toBeTruthy();
    fireEvent.click(within(single).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('dialog', { name: '2 events' })).toBeTruthy();
  });

  it('legend chips toggle the same filter as the filter sheet', async () => {
    await seedDay();
    const ribbon = await openYesterday();
    const legend = screen.getByRole('list', { name: 'What the colours mean' });
    const feeding = within(legend).getByRole('button', { name: 'Feeding' });
    expect(feeding.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(feeding);
    expect(feeding.getAttribute('aria-pressed')).toBe('false');
    // The ribbon and the rows lose the feed; the filter button counts the shown categories.
    await waitFor(() => expect(ribbonButtons(ribbon)).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /^Edit Bottle/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Filter, \d active$/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Show on this day' });
    expect(
      within(sheet).getByRole('checkbox', { name: 'Feeding' }).getAttribute('aria-checked'),
    ).toBe('false');
    // And back: the sheet's Clear shows everything on the ribbon again.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(ribbonButtons(ribbon)).toHaveLength(3));
    expect(feeding.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks now on today', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    await screen.findByRole('group', { name: /^The day at a glance/ });
    expect(document.querySelector('[data-testid="ribbon-now"]')).toBeTruthy();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seedDay();
    renderWithDb(db, <DayPage />);
    const heading = await screen.findByRole('heading', { level: 1 });
    fireEvent.touchStart(heading, { touches: [{ clientX: 40, clientY: 100 }] });
    fireEvent.touchEnd(heading, { changedTouches: [{ clientX: 220, clientY: 100 }] });
    const ribbon = await screen.findByRole('group', { name: /^O dia em resumo/ });
    await waitFor(() => expect(ribbonButtons(ribbon)).toHaveLength(3));
    expect(screen.getByText('1 soneca')).toBeTruthy();
  });
});
