import { screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../../db/models';
import { activateLocale } from '../../i18n/i18n';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../../test/builtInTypes';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
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
const WINDOW = { earliest: at(11, 20).toISOString(), latest: at(12, 11).toISOString() };

function renderRing(props: Partial<Parameters<typeof DayRing>[0]> = {}) {
  return renderUi(
    <DayRing
      events={MORNING}
      types={TYPES}
      now={at(11, 11)}
      window={WINDOW}
      stateLabel="Awake"
      duration="52m"
      {...props}
    />,
  );
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
    // Only sleep, the window and now are drawn: no event dots, no wake-up or bedtime dots.
    expect(ring.querySelectorAll('svg[role="img"] circle')).toHaveLength(2); // track + now dot
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

  it('has a legend list naming each mark the ring draws', () => {
    renderRing();
    const legend = screen.getByRole('list', { name: 'What the ring shows' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Night sleep', 'Nap', 'Nap window', 'Now']);
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
    expect(within(ring).getByRole('img').getAttribute('aria-label')).toContain(
      'No sleep logged today.',
    );
  });

  it('describes the state and the next window in a sentence', () => {
    renderRing();
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/^Day rhythm\. Awake 52m\. Next nap window \d\d:\d\d to \d\d:\d\d\./);
  });

  it('draws a running sleep up to now', () => {
    renderRing({
      events: [event('run', SLEEP_TYPE.id, at(10, 30), null, { kind: 'nap' })],
      window: undefined,
      stateLabel: 'Asleep · Nap',
      duration: '41m',
    });
    const ring = screen.getByTestId('day-ring');
    expect(within(ring).getAllByTestId('ring-span-nap')).toHaveLength(1);
    expect(within(ring).getByText('Asleep · Nap')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    renderRing();
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

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
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /Próxima janela de soneca de \d\d:\d\d a \d\d:\d\d\./,
    );
  });
});
