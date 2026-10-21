import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test/renderUi';
import type { TodayStats } from '../todayStats';
import { TodayStrip } from './TodayStrip';

const NONE: TodayStats = {
  lastNightMinutes: null,
  naps: { count: 0, minutes: 0 },
  feeds: 0,
  diapers: 0,
};

describe('TodayStrip', () => {
  it('shows last night, naps with their total, feeds and diapers as numbers', () => {
    renderUi(
      <TodayStrip
        stats={{ lastNightMinutes: 610, naps: { count: 2, minutes: 85 }, feeds: 5, diapers: 6 }}
      />,
    );
    const strip = screen.getByRole('region', { name: 'Today' });
    const items = within(strip)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(items).toEqual(['Last night', 'Naps', 'Feeds', 'Diapers']);
    const values = within(strip)
      .getAllByRole('definition')
      .map((value) => value.textContent);
    expect(values).toEqual(['10h 10m', '2', '1h 25m', '5', '6']);
  });

  it('leaves out a value without data and hides the whole strip when nothing is known', () => {
    const { unmount } = renderUi(<TodayStrip stats={{ ...NONE, feeds: 3 }} />);
    const strip = screen.getByRole('region', { name: 'Today' });
    expect(
      within(strip)
        .getAllByRole('term')
        .map((t) => t.textContent),
    ).toEqual(['Feeds']);
    unmount();

    renderUi(<TodayStrip stats={NONE} />);
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull();
  });
});
