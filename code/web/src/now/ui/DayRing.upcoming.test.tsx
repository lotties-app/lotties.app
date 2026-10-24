import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../../db/models';
import { activateLocale } from '../../i18n/i18n';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../../test/builtInTypes';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import type { UpcomingItem } from '../upcoming';
import { DayRing } from './DayRing';
import {
  bellyItem,
  bottleItem,
  busyAfternoon,
  medicineItem,
  upAt as at,
  wetItem,
} from './upcomingKit';

/*
 * The "next up" layer of the day ring (docs/DESIGN.md "Now: next up on the ring"): markers on the
 * inner lane, the layer chips, clustering, the shared detail strip and keyboard, the legend and the
 * "Next up" list. Fixed local times on 2026-10-21, now 14:00.
 */

const TYPES: EventType[] = [SLEEP_TYPE, FEEDING_TYPE, DIAPER_TYPE];
const NOW = at(14);

function sleep(id: string, from: Date, to: Date, kind: string): BabyEvent {
  return {
    id,
    babyId: 'b',
    typeId: SLEEP_TYPE.id,
    startedAt: from.toISOString(),
    endedAt: to.toISOString(),
    payload: { kind },
    notes: null,
    createdBy: null,
    createdAt: from.toISOString(),
    updatedAt: from.toISOString(),
    deletedAt: null,
  };
}

const EVENTS = [
  sleep('night', at(19, 30, 20), at(6, 40), 'night'),
  sleep('nap', at(12, 0), at(13, 10), 'nap'),
];
const WINDOW = { earliest: at(15, 0).toISOString(), latest: at(15, 45).toISOString() };

function renderRing(upcoming: UpcomingItem[] | null = busyAfternoon()) {
  return renderUi(
    <DayRing
      events={EVENTS}
      types={TYPES}
      now={NOW}
      window={WINDOW}
      stateLabel="Awake"
      duration="50m"
      state={{ kind: 'awake', since: at(13, 10).toISOString(), minutes: 50 }}
      {...(upcoming ? { upcoming } : {})}
    />,
  );
}

const strip = () => screen.getByTestId('rhythm-detail');
const chart = () => within(screen.getByRole('group', { name: /^Day rhythm/ }));
const chip = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  window.localStorage.clear();
  await activateLocale('en');
});

describe('the next-up lane of the ring', () => {
  it('draws feeds and diapers by default, as estimates with their windows', () => {
    renderRing();
    expect(screen.getByTestId('ring-upcoming-feed')).toBeTruthy();
    expect(screen.getByTestId('ring-upcoming-diaperWet')).toBeTruthy();
    expect(screen.getByTestId('ring-upcoming-diaperDirty').getAttribute('data-confidence')).toBe(
      'low',
    );
    expect(screen.getByTestId('ring-upcoming-diaperDirty').getAttribute('opacity')).toBe('0.55');
    expect(screen.getAllByTestId('ring-upcoming-window').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('ring-upcoming-bellyPain')).toBeNull();
    expect(screen.queryByTestId('ring-upcoming-medicine')).toBeNull();
    const legend = screen.getByRole('list', { name: 'What the ring shows' });
    expect(within(legend).getByText('Next feed (estimate)')).toBeTruthy();
    expect(within(legend).getByText('Next diapers (estimate)')).toBeTruthy();
    expect(within(legend).queryByText('Usual patterns')).toBeNull();
  });

  it('turns layers on and off with the chips, remembered per device', () => {
    renderRing();
    const group = screen.getByRole('group', { name: 'Chart layers' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-pressed')),
    ).toEqual(['true', 'true', 'true', 'false', 'false']);
    fireEvent.click(chip(/^Show Patterns/));
    fireEvent.click(chip(/^Show Medicine/));
    expect(screen.getByTestId('ring-upcoming-bellyPain')).toBeTruthy();
    expect(screen.getByTestId('ring-upcoming-medicine')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('baby-routine.now-layers') ?? '[]')).toEqual([
      'sleep',
      'feeds',
      'diapers',
      'patterns',
      'medicine',
    ]);
    fireEvent.click(chip(/^Show Feeds/));
    expect(screen.queryByTestId('ring-upcoming-feed')).toBeNull();
    expect(
      within(screen.getByTestId('upcoming-list')).queryByTestId('upcoming-row-feed'),
    ).toBeNull();
  });

  it('hides the sleep marks with the Sleep chip, keeps now', () => {
    renderRing();
    expect(screen.getAllByTestId('ring-span-nap')).toHaveLength(1);
    fireEvent.click(chip(/^Show Sleep/));
    expect(screen.queryByTestId('ring-span-nap')).toBeNull();
    expect(screen.queryByTestId('ring-window')).toBeNull();
    expect(screen.queryByTestId('ring-window-line')).toBeNull();
    expect(screen.getByTestId('ring-now')).toBeTruthy();
    expect(screen.getByTestId('ring-upcoming-feed')).toBeTruthy();
  });

  it('shows a marker in the detail strip, with its basis and "estimate"', () => {
    renderRing();
    fireEvent.click(
      screen.getByRole('button', { name: /^Next bottle about 16:10 \(estimate\)\./ }),
    );
    expect(strip().textContent).toBe(
      'Next bottle about 16:10 (estimate) · Likely between 15:40 and 16:40 · Usually about 120 ml in the afternoon (110–140 ml) · At other times: about 100 ml at night · Based on 9 bottles in the last 14 days · From the feeding prediction (24 feeds)',
    );
    fireEvent.click(chart().getByRole('button', { name: /^A poop is likely between/ }));
    expect(strip().textContent).toBe(
      'A poop is likely between 18:00 and 20:00 (estimate) · Usually about once a day · Low confidence',
    );
  });

  it('moves to the markers with the arrow keys, in time order after now', () => {
    renderRing();
    const now = screen.getByTestId('rhythm-mark-now');
    now.focus();
    fireEvent.keyDown(now, { key: 'ArrowRight' });
    // The nap window at 15:00 comes before the bottle at 16:10.
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Next bottle about 16:10/);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(strip().textContent).toMatch(/^Next bottle about 16:10/);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(strip().textContent).toBe('');
  });

  it('clusters more than three markers that would overlap', () => {
    const close = [
      wetItem(at(21, 0)),
      medicineItem(at(21, 5), 'A'),
      medicineItem(at(21, 10), 'B'),
      medicineItem(at(21, 15), 'C'),
    ];
    window.localStorage.setItem('baby-routine.now-layers', JSON.stringify(['diapers', 'medicine']));
    renderRing(close);
    const cluster = screen.getByTestId('ring-upcoming-cluster');
    expect(cluster.getAttribute('data-count')).toBe('4');
    fireEvent.click(chart().getByRole('button', { name: /^4 things coming up from 21:00\./ }));
    expect(strip().textContent).toBe(
      '4 things coming up from 21:00 · Wet diaper likely around 21:00 (estimate) · A scheduled 21:05 · B scheduled 21:10 · C scheduled 21:15',
    );
    // Its rows select the cluster.
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection' }));
    fireEvent.click(screen.getByRole('button', { name: /^Show all \(4\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /^C scheduled 21:15/ }));
    expect(
      chart()
        .getByRole('button', { name: /^4 things coming up/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('spreads two or three close markers apart instead', () => {
    const close = [bottleItem(at(16, 0)), wetItem(at(16, 5))];
    renderRing(close);
    expect(screen.queryByTestId('ring-upcoming-cluster')).toBeNull();
    expect(screen.getByTestId('ring-upcoming-feed')).toBeTruthy();
    expect(screen.getByTestId('ring-upcoming-diaperWet')).toBeTruthy();
  });
});

describe('the "Next up" list', () => {
  it('lists the next three, "Show all" expands, a row highlights its marker', () => {
    window.localStorage.setItem(
      'baby-routine.now-layers',
      JSON.stringify(['sleep', 'feeds', 'diapers', 'patterns', 'medicine']),
    );
    renderRing();
    const list = screen.getByRole('list', { name: 'Next up' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    const more = screen.getByRole('button', { name: 'Show all (5)' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    const rows = within(list).getAllByRole('button');
    expect(rows.map((row) => row.querySelector('[data-at]')?.getAttribute('data-at'))).toEqual([
      '16:10',
      '16:40',
      '18:30',
      '19:00',
      '20:00',
    ]);
    fireEvent.click(within(list).getByTestId('upcoming-row-medicine'));
    expect(strip().textContent).toBe('Vitamin D scheduled 20:00 · From the prescription');
    expect(
      chart()
        .getByRole('button', { name: /^Vitamin D scheduled 20:00\. From/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(list).getByTestId('upcoming-row-medicine').getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('says nothing more is expected when the layers shown are empty', () => {
    renderRing([bellyItem(at(18, 30))]);
    expect(screen.getByTestId('upcoming-nothing').textContent).toBe(
      'Nothing more expected for the rest of today.',
    );
    expect(screen.queryByTestId('ring-upcoming-bellyPain')).toBeNull();
  });

  it('is not there without the next-up layer (the plain sleep ring)', () => {
    renderRing(null);
    expect(screen.queryByTestId('ring-layers')).toBeNull();
    expect(screen.queryByTestId('upcoming')).toBeNull();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderRing();
    expect(screen.getByRole('group', { name: 'Camadas do gráfico' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'A seguir' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('upcoming-row-feed'));
    expect(strip().textContent).toBe(
      'Próxima mamadeira por volta das 16:10 (estimativa) · Provavelmente entre 15:40 e 16:40 · Em geral cerca de 120 ml à tarde (110–140 ml) · Em outros horários: cerca de 100 ml de madrugada · Com base em 9 mamadeiras nos últimos 14 dias · Da previsão de mamadas (24 mamadas)',
    );
  });
});

function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

describe('accessibility of the next-up layer', () => {
  for (const scheme of ['light', 'dark', 'night'] as const) {
    it(`has no axe violations in ${scheme}, all layers on, a marker selected, the list open`, async () => {
      chooseScheme(scheme);
      window.localStorage.setItem(
        'baby-routine.now-layers',
        JSON.stringify(['sleep', 'feeds', 'diapers', 'patterns', 'medicine']),
      );
      renderRing();
      fireEvent.click(screen.getByRole('button', { name: 'Show all (5)' }));
      fireEvent.click(screen.getByTestId('upcoming-row-feed'));
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
