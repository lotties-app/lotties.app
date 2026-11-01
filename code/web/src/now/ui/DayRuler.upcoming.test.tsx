import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateLocale } from '../../i18n/i18n';
import { renderUi } from '../../test/renderUi';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import type { UpcomingItem } from '../upcoming';
import { DayRuler } from './DayRuler';
import { bottleItem, busyAfternoon, medicineItem, upAt as at, wetItem } from './upcomingKit';

/*
 * The "next up" lane under the ruler: the same markers, chips, details, keyboard and list as the
 * ring, on a thin lane under the bar, which then reaches the last item. Now 14:00 on 2026-10-21.
 */

const WINDOW = { earliest: at(15, 0).toISOString(), latest: at(15, 45).toISOString() };

function renderRuler(upcoming: UpcomingItem[] | null = busyAfternoon()) {
  return renderUi(
    <DayRuler
      since={at(13, 10).toISOString()}
      now={at(14)}
      window={WINDOW}
      minutes={50}
      {...(upcoming ? { upcoming } : {})}
    />,
  );
}

const ruler = () => within(screen.getByRole('group', { name: /^Awake since 13:10/ }));
const strip = () => screen.getByTestId('rhythm-detail');

beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  window.localStorage.clear();
  await activateLocale('en');
});

describe('the next-up lane of the ruler', () => {
  it('draws the default layers on the lane and reaches the last of them', () => {
    renderRuler();
    const lane = screen.getByTestId('ruler-lane');
    expect(within(lane).getByTestId('ruler-upcoming-feed')).toBeTruthy();
    expect(within(lane).getByTestId('ruler-upcoming-diaperWet')).toBeTruthy();
    expect(within(lane).queryByTestId('ruler-upcoming-medicine')).toBeNull();
    // The dirty diaper window ends at 20:00: the ruler ends 30 min later.
    expect(screen.getByText('20:30')).toBeTruthy();
    const legend = screen.getByRole('list', { name: 'What the ruler shows' });
    expect(within(legend).getByText('Next feed (estimate)')).toBeTruthy();
  });

  it('keeps the marks in time order for the arrow keys, selects and lists them', () => {
    renderRuler();
    const names = ruler()
      .getAllByRole('button')
      .map((b) => (b.getAttribute('aria-label') ?? '').split('.')[0]);
    expect(names).toEqual([
      'Now, 14:00, awake',
      'Nap window opens 15:00, closes 15:45',
      'Next bottle about 16:10 (estimate)',
      'Wet diaper likely around 16:40 (estimate)',
      'A poop is likely between 18:00 and 20:00 (estimate)',
    ]);
    fireEvent.click(ruler().getByTestId('ruler-upcoming-diaperWet'));
    expect(strip().textContent).toBe(
      'Wet diaper likely around 16:40 (estimate) · Likely between 16:20 and 17:00 · Usually about every 2h 30m',
    );
    const list = screen.getByRole('list', { name: 'Next up' });
    expect(within(list).getByTestId('upcoming-row-diaperWet').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows medicine with its chip and hides the window with Sleep off', () => {
    renderRuler([bottleItem(at(16, 10)), medicineItem(at(20, 0))]);
    fireEvent.click(screen.getByRole('button', { name: /^Show Medicine/ }));
    expect(screen.getByTestId('ruler-upcoming-medicine')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Show Sleep/ }));
    expect(screen.queryByTestId('ruler-window')).toBeNull();
    expect(screen.getByTestId('ruler-now')).toBeTruthy();
  });

  it('clusters more than three close markers on the lane', () => {
    window.localStorage.setItem('baby-routine.now-layers', JSON.stringify(['diapers', 'medicine']));
    renderRuler([
      wetItem(at(16, 0)),
      medicineItem(at(16, 5), 'A'),
      medicineItem(at(16, 10), 'B'),
      medicineItem(at(16, 15), 'C'),
    ]);
    expect(screen.getByTestId('ruler-upcoming-cluster').textContent).toBe('4');
  });

  it('is the plain ruler without the next-up layer', () => {
    renderRuler(null);
    expect(screen.queryByTestId('ruler-lane')).toBeNull();
    expect(screen.queryByTestId('ring-layers')).toBeNull();
    expect(screen.queryByTestId('upcoming')).toBeNull();
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`has no axe violations in ${scheme}`, async () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      renderRuler();
      fireEvent.click(ruler().getByTestId('ruler-upcoming-feed'));
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
