import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../test/renderUi';
import { setUnitSetting } from '../../units/state';
import type { TodayStats } from '../todayStats';
import { TodayStrip } from './TodayStrip';

const NONE: TodayStats = {
  lastNightMinutes: null,
  naps: { count: 0, minutes: 0 },
  feeds: 0,
  milk: null,
  diapers: 0,
};

describe('TodayStrip', () => {
  it('shows last night, naps with their total, feeds and diapers as numbers', () => {
    renderUi(
      <TodayStrip
        stats={{
          lastNightMinutes: 610,
          naps: { count: 2, minutes: 85 },
          feeds: 5,
          milk: null,
          diapers: 6,
        }}
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

  describe('bottle total under the feeds', () => {
    afterEach(() => setUnitSetting('auto'));

    it('shows the volume drunk as the note, named for screen readers', () => {
      setUnitSetting('metric');
      renderUi(
        <TodayStrip stats={{ ...NONE, feeds: 5, milk: { drunkMl: 1240, preparedMl: 1300 } }} />,
      );
      const strip = screen.getByRole('region', { name: 'Today' });
      expect(
        within(strip)
          .getAllByRole('definition')
          .map((value) => value.textContent),
      ).toEqual(['5', '1,240 ml']);
      expect(
        within(strip).getByRole('definition', { name: '1,240 ml drunk from bottles' }),
      ).toBeTruthy();
    });

    it('leaves the note empty without a bottle amount', () => {
      renderUi(<TodayStrip stats={{ ...NONE, feeds: 2 }} />);
      const strip = screen.getByRole('region', { name: 'Today' });
      expect(
        within(strip)
          .getAllByRole('definition')
          .map((value) => value.textContent),
      ).toEqual(['2']);
    });

    it('never shows "0 ml" when only untouched bottles were logged', () => {
      renderUi(<TodayStrip stats={{ ...NONE, feeds: 1, milk: { drunkMl: 0, preparedMl: 120 } }} />);
      const strip = screen.getByRole('region', { name: 'Today' });
      expect(
        within(strip)
          .getAllByRole('definition')
          .map((value) => value.textContent),
      ).toEqual(['1']);
    });

    it('shows the total in US units when the person uses them', () => {
      setUnitSetting('us');
      renderUi(
        <TodayStrip stats={{ ...NONE, feeds: 3, milk: { drunkMl: 360, preparedMl: 360 } }} />,
      );
      const strip = screen.getByRole('region', { name: 'Today' });
      expect(within(strip).getAllByRole('definition')[1]?.textContent).toMatch(/fl oz$/);
    });
  });
});
