import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../../db/models';
import { activateLocale } from '../../i18n/i18n';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../../test/builtInTypes';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import type { NapProjection } from '../napProjection';
import { DayRing } from './DayRing';

const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 21 + dayOffset, h, m);
const TYPES: EventType[] = [SLEEP_TYPE, FEEDING_TYPE, DIAPER_TYPE];

function event(
  id: string,
  typeId: string,
  from: Date,
  to: Date | null,
  payload: BabyEvent['payload'] = {},
): BabyEvent {
  return {
    id,
    babyId: 'b',
    typeId,
    startedAt: from.toISOString(),
    endedAt: to ? to.toISOString() : null,
    payload,
    notes: null,
    createdBy: null,
    createdAt: from.toISOString(),
    updatedAt: from.toISOString(),
    deletedAt: null,
  };
}

/** The owner's morning: a night, a nap, feeds and diapers; awake since 10:19, now 11:11. */
const MORNING: BabyEvent[] = [
  event('night', SLEEP_TYPE.id, at(19, 30, -1), at(6, 40), { kind: 'night' }),
  event('nap', SLEEP_TYPE.id, at(8, 50), at(10, 19), { kind: 'nap' }),
  event('feed1', FEEDING_TYPE.id, at(6, 50), at(7, 5), { method: 'breast', side: 'left' }),
  event('feed2', FEEDING_TYPE.id, at(10, 30), at(10, 30), { method: 'bottle', amount_ml: 90 }),
  event('diaper1', DIAPER_TYPE.id, at(7, 10), at(7, 10), { content: 'WET' }),
  event('diaper2', DIAPER_TYPE.id, at(10, 40), at(10, 40), { content: 'DIRTY' }),
];
const WINDOW = {
  earliest: at(11, 20).toISOString(),
  latest: at(12, 11).toISOString(),
  basis: { kind: 'AwakeWindow', medianGapMinutes: 135, lookBackDays: 7 },
};
const AWAKE = { kind: 'awake', since: at(10, 19).toISOString(), minutes: 52 } as const;

function renderRing(props: Partial<Parameters<typeof DayRing>[0]> = {}) {
  return renderUi(
    <DayRing
      events={MORNING}
      types={TYPES}
      now={at(11, 11)}
      window={WINDOW}
      stateLabel="Awake"
      duration="52m"
      state={AWAKE}
      {...props}
    />,
  );
}

const chart = () => screen.getByRole('group', { name: /^Day rhythm/ });
const strip = () => screen.getByTestId('rhythm-detail');

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

afterEach(async () => {
  window.localStorage.clear();
  await activateLocale('en');
});

describe('DayRing', () => {
  it('draws sleep, the nap window band and now, and no feed or diaper dots', () => {
    renderRing();
    const ring = screen.getByTestId('day-ring');
    expect(within(ring).getAllByTestId('ring-span-night')).toHaveLength(1);
    expect(within(ring).getAllByTestId('ring-span-nap')).toHaveLength(1);
    expect(within(ring).getAllByTestId('ring-window')).toHaveLength(1);
    expect(within(ring).getByTestId('ring-now')).toBeTruthy();
    // Only sleep, the window and now are drawn: every circle is the track or part of "now".
    const circles = Array.from(chart().querySelectorAll('circle'));
    const stray = circles.filter(
      (c) =>
        c.getAttribute('data-testid') !== 'ring-track' &&
        !c.closest('[data-testid="rhythm-mark-now"], [data-testid="ring-now"]'),
    );
    expect(stray).toEqual([]);
    expect(within(ring).queryByTestId(/^ring-marker-/)).toBeNull();
  });

  it('prints the window times under the ring, never on it', () => {
    renderRing();
    const ring = screen.getByTestId('day-ring');
    expect(within(ring).getByTestId('ring-window-line').textContent).toMatch(
      /^Next nap about \d\d:\d\d–\d\d:\d\d$/,
    );
    const drawn = Array.from(ring.querySelectorAll('svg text')).map((t) => t.textContent);
    expect(drawn).toEqual(['00', '06', '12', '18']);
  });

  it('says the window is open when now is inside it', () => {
    renderRing({ now: at(11, 40), duration: '1h 21m' });
    expect(screen.getByTestId('ring-window-line').textContent).toMatch(
      /^Nap window open until \d\d:\d\d$/,
    );
  });

  it('drops the hour label the now marker sits on', () => {
    renderRing({ now: at(12, 5), window: undefined });
    const drawn = Array.from(screen.getByTestId('day-ring').querySelectorAll('svg text')).map(
      (t) => t.textContent,
    );
    expect(drawn).toEqual(['00', '06', '18']);
  });

  it('has a legend list naming each mark the ring draws, with the face of now', () => {
    renderRing();
    const legend = screen.getByRole('list', { name: 'What the ring shows' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Night sleep', 'Nap', 'Nap window', 'Now']);
    expect(
      within(legend).getByTestId('ring-legend-face').querySelector('[data-illustration]'),
    ).toHaveProperty('dataset.illustration', 'baby_face_awake');
  });

  it('leaves the window out of the legend and the line without one, and on an empty day', () => {
    renderRing({ events: [], window: undefined });
    const ring = screen.getByTestId('day-ring');
    expect(within(ring).queryByTestId('ring-window-line')).toBeNull();
    expect(within(ring).queryByTestId(/^ring-span-/)).toBeNull();
    const legend = screen.getByRole('list', { name: 'What the ring shows' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['Now']);
    expect(chart().getAttribute('aria-label')).toContain('No sleep logged today.');
  });

  it('describes the state and the next window in a sentence', () => {
    renderRing();
    expect(chart().getAttribute('aria-label')).toMatch(
      /^Day rhythm\. Awake 52m\. Next nap window \d\d:\d\d to \d\d:\d\d\./,
    );
  });

  it('draws a running sleep up to now', () => {
    renderRing({
      events: [event('run', SLEEP_TYPE.id, at(10, 30), null, { kind: 'nap' })],
      window: undefined,
      stateLabel: 'Asleep · Nap',
      duration: '41m',
      state: { kind: 'asleep', since: at(10, 30).toISOString(), minutes: 41 },
    });
    const ring = screen.getByTestId('day-ring');
    expect(within(ring).getAllByTestId('ring-span-nap')).toHaveLength(1);
    expect(within(ring).getByText('Asleep · Nap')).toBeTruthy();
  });

  it('shows nothing extra until a mark is selected', () => {
    renderRing();
    expect(strip().textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear the selection' })).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('names every mark as a button with its details, in time order', () => {
    renderRing();
    const marks = within(chart()).getAllByRole('button');
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Night sleep 19:30 to 06:40, 11h 10m\.$/),
      expect.stringMatching(/^Nap 08:50 to 10:19, 1h 29m\.$/),
      'Now, 11:11, awake. Awake for 52m. Next: nap window opens 11:20.',
      'Nap window opens 11:20, closes 12:11. Opens in 9m. Based on the usual awake time of about 2h 15m.',
    ]);
    // One tab stop for the chart, on "now".
    expect(marks.map((m) => m.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1']);
  });

  it('shows the details in a tooltip on hover', async () => {
    renderRing();
    fireEvent.mouseOver(screen.getByTestId('rhythm-mark-window'));
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Nap window opens 11:20, closes 12:11. Opens in 9m. Based on the usual awake time of about 2h 15m.',
    );
  });

  it('selects a mark on tap and shows its details under the ring, again to clear', () => {
    renderRing();
    const window = screen.getByTestId('rhythm-mark-window');
    fireEvent.click(window);
    expect(window.getAttribute('aria-pressed')).toBe('true');
    expect(strip().textContent).toBe(
      'Nap window opens 11:20, closes 12:11 · Opens in 9m · Based on the usual awake time of about 2h 15m',
    );
    expect(strip().getAttribute('role')).toBe('status');
    fireEvent.click(window);
    expect(window.getAttribute('aria-pressed')).toBe('false');
    expect(strip().textContent).toBe('');
  });

  it('moves with the arrow keys in time order, selects with Enter and clears with Esc', () => {
    renderRing();
    const now = screen.getByTestId('rhythm-mark-now');
    now.focus();
    fireEvent.keyDown(now, { key: 'ArrowLeft' });
    const nap = screen.getAllByRole('button', { name: /^Nap 08:50/ })[0];
    expect(document.activeElement).toBe(nap);
    fireEvent.keyDown(nap, { key: 'Enter' });
    expect(strip().textContent).toBe('Nap 08:50 to 10:19, 1h 29m');
    fireEvent.keyDown(nap, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('rhythm-mark-window'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(strip().textContent).toBe('');
  });

  it('clears from the strip and gives the focus back to the mark', () => {
    renderRing();
    fireEvent.click(screen.getByTestId('rhythm-mark-now'));
    expect(strip().textContent).toMatch(/^Now, 11:11, awake · Awake for 52m/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection' }));
    expect(strip().textContent).toBe('');
    expect(document.activeElement).toBe(screen.getByTestId('rhythm-mark-now'));
  });

  it('shows the face of the moment: awake, drowsy in the window, tired, asleep', () => {
    const face = () => screen.getByTestId('ring-now').getAttribute('data-face');
    const { unmount } = renderRing();
    expect(face()).toBe('awake');
    unmount();
    const inside = renderRing({ now: at(11, 40) });
    expect(face()).toBe('drowsy');
    expect(screen.getByTestId('rhythm-mark-now').getAttribute('aria-label')).toMatch(
      /^Now, 11:40, awake, nap window open\./,
    );
    inside.unmount();
    const tired = renderRing({ now: at(11, 40), overtired: true });
    expect(face()).toBe('tired');
    tired.unmount();
    renderRing({
      window: undefined,
      state: { kind: 'asleep', since: at(10, 30).toISOString(), minutes: 41 },
    });
    expect(face()).toBe('asleep');
    expect(
      screen.getByTestId('ring-now').querySelector('[data-illustration="baby_face_asleep"]'),
    ).toBeTruthy();
  });

  it('draws the projected naps fainter further out, with a legend entry and estimate labels', () => {
    const projection: NapProjection = {
      wake: null,
      windows: [
        {
          index: 1,
          earliest: at(14, 30).getTime(),
          expected: at(14, 45).getTime(),
          latest: at(15, 15).getTime(),
        },
        {
          index: 2,
          earliest: at(17, 30).getTime(),
          expected: at(17, 45).getTime(),
          latest: at(18, 15).getTime(),
        },
      ],
      basis: { gapKind: 'awake', gapMinutes: 135, napMinutes: 60 },
    };
    renderRing({
      projection,
      bedTime: { earliest: at(19, 20).toISOString(), latest: at(20, 10).toISOString() },
    });
    const bands = screen.getAllByTestId('ring-projected');
    expect(bands.map((b) => b.getAttribute('data-upcoming'))).toEqual(['1', '2']);
    expect(bands.map((b) => Number(b.getAttribute('stroke-opacity')))).toEqual([0.7, 0.5]);
    expect(bands.every((b) => b.getAttribute('stroke-dasharray'))).toBe(true);
    expect(screen.getByTestId('ring-bedtime')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Later nap window about 14:30 to 15:15 (estimate). Based on the usual awake time of about 2h 15m and naps of about 1h.',
      }),
    ).toBeTruthy();
    const legend = screen.getByRole('list', { name: 'What the ring shows' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual([
      'Night sleep',
      'Nap',
      'Nap window',
      'Next naps (estimate)',
      'Bedtime window',
      'Now',
    ]);
  });

  it('while asleep: the likely wake-up with a dotted tail and the next window named under the ring', () => {
    renderRing({
      events: [...MORNING, event('run', SLEEP_TYPE.id, at(10, 50), null, { kind: 'nap' })],
      window: undefined,
      now: at(11, 11),
      state: { kind: 'asleep', since: at(10, 50).toISOString(), minutes: 21 },
      projection: {
        wake: { from: at(11, 11).getTime(), at: at(12, 20).getTime() },
        windows: [
          {
            index: 1,
            earliest: at(14, 20).getTime(),
            expected: at(14, 35).getTime(),
            latest: at(15, 5).getTime(),
          },
        ],
        basis: { gapKind: 'awake', gapMinutes: 135, napMinutes: 90 },
      },
    });
    expect(screen.getByTestId('ring-wake')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Likely to wake about 12:20 (estimate). Based on naps of about 1h 30m.',
      }),
    ).toBeTruthy();
    expect(Number(screen.getByTestId('ring-projected').getAttribute('stroke-opacity'))).toBe(1);
    expect(screen.getByTestId('ring-window-line').textContent).toBe('Next nap about 14:20–15:05');
    const legend = screen.getByRole('list', { name: 'What the ring shows' });
    expect(within(legend).getByText('Likely wake-up (estimate)')).toBeTruthy();
    expect(within(legend).getByText('Next naps (estimate)')).toBeTruthy();
  });

  for (const scheme of ['light', 'dark', 'night'] as const) {
    it(`has no axe violations in ${scheme}, with a mark selected`, async () => {
      chooseScheme(scheme);
      renderRing();
      fireEvent.click(screen.getByTestId('rhythm-mark-window'));
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    });
  }

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderRing({ stateLabel: 'Acordado' });
    expect(screen.getByTestId('ring-window-line').textContent).toMatch(
      /^Próxima soneca por volta de \d\d:\d\d–\d\d:\d\d$/,
    );
    const legend = screen.getByRole('list', { name: 'O que o anel mostra' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['Sono da noite', 'Soneca', 'Janela de soneca', 'Agora']);
    expect(screen.getByRole('group', { name: /^Ritmo do dia/ }).getAttribute('aria-label')).toMatch(
      /Próxima janela de soneca de \d\d:\d\d a \d\d:\d\d\./,
    );
    fireEvent.click(screen.getByTestId('rhythm-mark-window'));
    expect(strip().textContent).toBe(
      'Janela da soneca abre às 11:20, fecha às 12:11 · Abre em 9 min · Com base no tempo acordado de costume, cerca de 2 h 15 min',
    );
    expect(screen.getByRole('button', { name: 'Limpar a seleção' })).toBeTruthy();
  });
});
