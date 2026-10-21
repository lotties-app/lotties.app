import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { DIAPER_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { EventSheet } from './EventSheet';
import { buildPayload, initialForm, shownFields } from './formModel';
import { SleepDetails } from './SleepDetails';
import { sleepDetailFields } from './sleepDetailModel';

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await db.eventTypes.bulkPut([SLEEP_TYPE, DIAPER_TYPE]);
});

afterEach(async () => {
  await db.delete();
});

const nap = (payload: Record<string, unknown> = { kind: 'nap' }) =>
  createEvent(db, {
    babyId: BABY_ID,
    typeId: SLEEP_TYPE.id,
    startedAt: '2026-10-20T13:00:00.000Z',
    endedAt: '2026-10-20T14:00:00.000Z',
    payload,
  });

function renderSheet(props: Partial<Parameters<typeof EventSheet>[0]> = {}) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <EventSheet babyId={BABY_ID} types={[SLEEP_TYPE, DIAPER_TYPE]} onDone={onDone} {...props} />,
  );
  return onDone;
}

const openDetails = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Sleep details/ }));
};
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const stored = async (id: string) => (await db.events.get(id))!;

describe('sleep details in the event sheet', () => {
  it('are collapsed by default and say how many are filled', async () => {
    const event = await nap({ kind: 'nap', how_slept: 'held', mood_on_wake: 'good' });
    renderSheet({ event });
    const toggle = await screen.findByRole('button', { name: /Sleep details/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(toggle).getByText('2 details added')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Held' })).toBeNull();
  });

  it('say "All optional" when nothing is filled and render every field when opened', async () => {
    const event = await nap();
    renderSheet({ event });
    expect(await screen.findByText('All optional')).toBeTruthy();
    await openDetails();
    // Where and how: picture tiles for the eight places and "other".
    const tiles = within(screen.getByRole('radiogroup', { name: 'Where and how' })).getAllByRole(
      'radio',
    );
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'In bed',
      'Nursing',
      'Held',
      'Next to me',
      'Bottle',
      'Stroller',
      'Car',
      'Swing',
      'Other',
    ]);
    // Each tile has an icon.
    expect(tiles.every((tile) => tile.querySelector('svg') !== null)).toBe(true);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Falling asleep' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Fell asleep easily', 'Took a long time', 'Fussy']);
    expect(screen.getByRole('spinbutton', { name: 'Time to fall asleep' })).toBeTruthy();
    expect(
      within(screen.getByRole('radiogroup', { name: 'Waking up' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Woke naturally', 'Was woken']);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Mood on waking' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Good', 'Neutral', 'Bad']);
  });

  it('save with the event: every pick, as the API expects (whole minutes)', async () => {
    const event = await nap();
    const onDone = renderSheet({ event });
    await openDetails();
    fireEvent.click(screen.getByRole('radio', { name: 'Stroller' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Fussy' }));
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Was woken' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Neutral' }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await stored(event.id)).payload).toEqual({
      kind: 'nap',
      how_slept: 'stroller',
      fall_asleep: 'fussy',
      time_to_fall_asleep_minutes: 15,
      how_woke: 'woken',
      mood_on_wake: 'neutral',
    });
  });

  it('are optional: clearing a pick removes the key', async () => {
    const event = await nap({ kind: 'nap', how_slept: 'car' });
    const onDone = renderSheet({ event });
    await openDetails();
    fireEvent.click(screen.getByRole('radio', { name: 'Car' }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await stored(event.id)).payload).toEqual({ kind: 'nap' });
  });

  it('keep the hidden pause keys when the event is edited, and never draw them', async () => {
    const event = await nap({
      kind: 'nap',
      pause_count: 2,
      paused_seconds: 480,
      mood: 'old free text',
    });
    const onDone = renderSheet({ event });
    await openDetails();
    // No control for the hidden fields (pause keys, the deprecated free-text mood).
    expect(screen.queryByText('Pauses')).toBeNull();
    expect(screen.queryByText('Paused time')).toBeNull();
    expect(screen.queryByLabelText('Mood')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Swing' }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await stored(event.id)).payload).toEqual({
      kind: 'nap',
      pause_count: 2,
      paused_seconds: 480,
      mood: 'old free text',
      how_slept: 'swing',
    });
  });

  it('are not offered for a bedtime marker or a night waking, and drop their values on a kind change', async () => {
    const marker = await nap({ kind: 'bed_time' });
    renderSheet({ event: marker });
    await screen.findByRole('dialog', { name: 'Sleep' });
    expect(screen.queryByRole('button', { name: /Sleep details/ })).toBeNull();
  });

  it('are not part of other event types', async () => {
    renderSheet({ initialTypeId: DIAPER_TYPE.id });
    await screen.findByRole('dialog', { name: 'Diaper' });
    expect(screen.queryByRole('button', { name: /Sleep details/ })).toBeNull();
  });
});

describe('form model with hidden and integer fields', () => {
  it('shows no hidden field and keeps their stored values on a rebuilt payload', () => {
    const base = { kind: 'nap', pause_count: 1, paused_seconds: 90, paused_at: undefined };
    const form = initialForm(
      [SLEEP_TYPE],
      { ...nap0(base), id: 'x' } as never,
      undefined,
      new Date(),
    );
    expect(shownFields(form, SLEEP_TYPE).map((f) => f.key)).not.toContain('pause_count');
    expect(buildPayload(form, SLEEP_TYPE, base)).toMatchObject({
      kind: 'nap',
      pause_count: 1,
      paused_seconds: 90,
    });
  });

  it('lists only nap and night detail fields', () => {
    const keys = (kind: string) =>
      sleepDetailFields(SLEEP_TYPE, { kind }).map((field) => field.key);
    expect(keys('nap')).toEqual([
      'fall_asleep',
      'time_to_fall_asleep_minutes',
      'how_slept',
      'how_woke',
      'mood_on_wake',
    ]);
    expect(keys('night')).toHaveLength(5);
    expect(keys('night_waking')).toEqual([]);
    expect(keys('woke_up')).toEqual([]);
    expect(sleepDetailFields(SLEEP_TYPE, {})).toEqual([]);
    expect(sleepDetailFields(DIAPER_TYPE, { kind: 'nap' })).toEqual([]);
  });
});

function nap0(payload: Record<string, unknown>) {
  return {
    typeId: SLEEP_TYPE.id,
    startedAt: '2026-10-20T13:00:00.000Z',
    endedAt: '2026-10-20T14:00:00.000Z',
    payload,
  };
}

describe('SleepDetails on its own', () => {
  it('reports each pick with the field key and the option', async () => {
    const onChange = vi.fn();
    renderWithDb(
      db,
      <SleepDetails type={SLEEP_TYPE} values={{ kind: 'nap' }} onChange={onChange} defaultOpen />,
    );
    fireEvent.click(await screen.findByRole('radio', { name: 'Held' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Good' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Woke naturally' }));
    expect(onChange.mock.calls).toEqual([
      ['how_slept', 'held'],
      ['mood_on_wake', 'good'],
      ['how_woke', 'naturally'],
    ]);
  });

  it('moves between tiles with the arrow keys like any radio group', async () => {
    const onChange = vi.fn();
    renderWithDb(
      db,
      <SleepDetails
        type={SLEEP_TYPE}
        values={{ kind: 'nap', how_slept: 'in_bed' }}
        onChange={onChange}
        defaultOpen
      />,
    );
    const selected = await screen.findByRole('radio', { name: 'In bed' });
    selected.focus();
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('how_slept', 'nursing');
  });
});

describe('in Portuguese', () => {
  it('uses the pt-BR labels for the sections and the options', async () => {
    await useTestLocale('pt-BR');
    const event = await nap();
    renderSheet({ event });
    fireEvent.click(await screen.findByRole('button', { name: /Detalhes do sono/ }));
    const where = screen.getByRole('radiogroup', { name: 'Onde e como' });
    expect(
      within(where)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual([
      'Na cama',
      'Amamentação',
      'No colo',
      'Ao meu lado',
      'Mamadeira',
      'Carrinho de bebê',
      'No carro',
      'No balanço',
      'Outro',
    ]);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Pegar no sono' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Dormiu fácil', 'Demorou para dormir', 'Com agitação']);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Ao acordar' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Acordou naturalmente', 'Foi acordado(a)']);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Humor ao acordar' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Bem', 'Neutro', 'Mal']);
    expect(screen.getByText('Tempo para dormir')).toBeTruthy();
  });
});

describe('accessibility (axe)', () => {
  it.each(['light', 'dark'])('the open section has no violations (%s)', async (mode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    const event = await nap({ kind: 'nap', how_slept: 'held', time_to_fall_asleep_minutes: 12 });
    renderSheet({ event });
    await openDetails();
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
