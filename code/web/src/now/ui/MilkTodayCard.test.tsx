import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { activateLocale } from '../../i18n/i18n';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
import { setUnitSetting } from '../../units/state';
import type { TodayStats } from '../todayStats';
import { MilkTodayCard } from './MilkTodayCard';
import { TodayStrip } from './TodayStrip';

afterEach(async () => {
  setUnitSetting('auto');
  await activateLocale('en');
});

const card = () => screen.getByRole('region', { name: 'Milk today' });
const pairs = (region: HTMLElement) =>
  within(region)
    .getAllByRole('term')
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);

describe('MilkTodayCard', () => {
  it('shows drunk and prepared side by side and what was not drunk', () => {
    setUnitSetting('metric');
    renderUi(<MilkTodayCard milk={{ drunkMl: 300, preparedMl: 420 }} />);
    expect(screen.getByRole('heading', { name: 'Milk today' })).toBeTruthy();
    expect(pairs(card())).toEqual([
      ['drunk', '300 ml'],
      ['prepared', '420 ml'],
    ]);
    expect(within(card()).getByText('Not drunk: 120 ml')).toBeTruthy();
    // The bar is decorative: the numbers carry the information.
    expect(within(card()).queryByRole('progressbar')).toBeNull();
    expect(within(card()).queryByText(/%/)).toBeNull();
  });

  it('has no "not drunk" line when everything was drunk', () => {
    setUnitSetting('metric');
    renderUi(<MilkTodayCard milk={{ drunkMl: 240, preparedMl: 240 }} />);
    expect(within(card()).queryByText(/Not drunk/)).toBeNull();
  });

  it('shows a bottle with nothing drunk', () => {
    setUnitSetting('metric');
    renderUi(<MilkTodayCard milk={{ drunkMl: 0, preparedMl: 120 }} />);
    expect(pairs(card())).toEqual([
      ['drunk', '0 ml'],
      ['prepared', '120 ml'],
    ]);
    expect(within(card()).getByText('Not drunk: 120 ml')).toBeTruthy();
  });

  it('is hidden without a bottle amount', () => {
    renderUi(<MilkTodayCard milk={null} />);
    expect(screen.queryByRole('region', { name: 'Milk today' })).toBeNull();
  });

  it('speaks fl oz and keeps the three numbers consistent', () => {
    setUnitSetting('us');
    renderUi(<MilkTodayCard milk={{ drunkMl: 66, preparedMl: 100 }} />);
    expect(pairs(card())).toEqual([
      ['drunk', '2.2 fl oz'],
      ['prepared', '3.4 fl oz'],
    ]);
    expect(within(card()).getByText('Not drunk: 1.2 fl oz')).toBeTruthy();
  });

  it('translates to Portuguese', async () => {
    await useTestLocale('pt-BR');
    setUnitSetting('metric');
    renderUi(<MilkTodayCard milk={{ drunkMl: 300, preparedMl: 420 }} />);
    const region = screen.getByRole('region', { name: 'Leite hoje' });
    expect(pairs(region)).toEqual([
      ['bebidos', '300 ml'],
      ['preparados', '420 ml'],
    ]);
    expect(within(region).getByText('Não bebidos: 120 ml')).toBeTruthy();
  });

  it.each(['metric', 'us'] as const)(
    'shows the same drunk number as the Feeds note (%s)',
    (system) => {
      setUnitSetting(system);
      const stats: TodayStats = {
        lastNightMinutes: null,
        naps: { count: 0, minutes: 0 },
        feeds: 4,
        milk: { drunkMl: 1237, preparedMl: 1410 },
        diapers: 0,
      };
      renderUi(
        <>
          <MilkTodayCard milk={stats.milk} />
          <TodayStrip stats={stats} />
        </>,
      );
      const strip = screen.getByRole('region', { name: 'Today' });
      const note = within(strip).getAllByRole('definition')[1]?.textContent;
      expect(note).toBeTruthy();
      expect(pairs(card())[0]).toEqual(['drunk', note]);
    },
  );
});
