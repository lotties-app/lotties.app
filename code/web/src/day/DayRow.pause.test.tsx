import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { presentEvent } from '../timeline/eventPresentation';
import { BUILT_IN_TYPES, SLEEP, event } from '../presets/presetFixtures';
import { FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { useTestLocale } from '../test/locale';
import { renderUi } from '../test/renderUi';
import { DayRow } from './DayRow';

const nap = (overrides: Partial<BabyEvent>): BabyEvent =>
  event({
    id: 'n',
    typeId: SLEEP,
    startedAt: '2026-10-20T13:00:00.000Z',
    endedAt: '2026-10-20T14:15:00.000Z',
    payload: { kind: 'nap' },
    ...overrides,
  });

function renderRow(e: BabyEvent) {
  return renderUi(
    <ul>
      <DayRow
        event={e}
        type={SLEEP_TYPE}
        medications={[]}
        syncState={undefined}
        hasNext={false}
        onEdit={() => undefined}
      />
    </ul>,
  );
}

describe('DayRow durations', () => {
  it('shows the plain duration without pauses', () => {
    renderRow(nap({}));
    expect(screen.getByText('1h 15m')).toBeTruthy();
    expect(screen.queryByText(/paused/)).toBeNull();
  });

  it('shows the effective duration with a quiet "paused 4m" under it', () => {
    renderRow(nap({ payload: { kind: 'nap', pause_count: 1, paused_seconds: 240 } }));
    expect(screen.getByText('1h 11m')).toBeTruthy();
    expect(screen.queryByText('1h 15m')).toBeNull();
    expect(screen.getByText('paused 4m')).toBeTruthy();
  });

  it('labels a running paused timer as Paused instead of Running', () => {
    renderRow(
      nap({
        endedAt: null,
        payload: { kind: 'nap', paused_at: new Date(Date.now() - 60_000).toISOString() },
      }),
    );
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.queryByText('Running')).toBeNull();
  });

  it('is written in Portuguese too', async () => {
    await useTestLocale('pt-BR');
    renderRow(nap({ payload: { kind: 'nap', pause_count: 1, paused_seconds: 240 } }));
    expect(screen.getByText('1 h 11 min')).toBeTruthy();
    expect(screen.getByText('pausa de 4 min')).toBeTruthy();
  });
});

describe('DayRow of a bottle', () => {
  const bottle = (endedAt: string): BabyEvent =>
    event({
      id: 'b',
      typeId: FEEDING_TYPE.id,
      startedAt: '2026-10-20T13:00:00.000Z',
      endedAt,
      payload: { method: 'bottle', amount_ml: 120 },
    });
  const renderBottle = (e: BabyEvent) =>
    renderUi(
      <ul>
        <DayRow
          event={e}
          type={FEEDING_TYPE}
          medications={[]}
          syncState={undefined}
          hasNext={false}
          onEdit={() => undefined}
        />
      </ul>,
    );

  it('shows how long the bottle took', () => {
    renderBottle(bottle('2026-10-20T13:18:00.000Z'));
    expect(screen.getByText('Bottle')).toBeTruthy();
    expect(screen.getByText('120 ml')).toBeTruthy();
    expect(screen.getByText('18m')).toBeTruthy();
  });

  it('shows no duration (never "0m") for an older bottle that ends when it starts', () => {
    renderBottle(bottle('2026-10-20T13:00:00.000Z'));
    expect(screen.getByText('120 ml')).toBeTruthy();
    expect(screen.queryByText('0m')).toBeNull();
    expect(screen.queryByText(/\d+m$/)).toBeNull();
  });
});

describe('the detail line of a sleep', () => {
  it('summarises the details in words, never as codes, and leaves the pause keys out', () => {
    const view = presentEvent(
      nap({
        payload: {
          kind: 'nap',
          how_slept: 'in_bed',
          fall_asleep: 'took_long',
          time_to_fall_asleep_minutes: 12,
          how_woke: 'naturally',
          mood_on_wake: 'good',
          pause_count: 2,
          paused_seconds: 300,
          mood: 'deprecated text',
        },
      }),
      SLEEP_TYPE,
      [],
    );
    expect(view.title).toBe('Nap');
    expect(view.detail).toBe(
      'In bed · Took a long time · fell asleep in 12m · Woke naturally · Mood on waking: good',
    );
    expect(view.detail).not.toMatch(/pause|deprecated|_/);
  });

  it('reads "Nap, in bed, woke naturally" for a short summary', () => {
    const view = presentEvent(
      nap({ payload: { kind: 'nap', how_slept: 'in_bed', how_woke: 'naturally' } }),
      SLEEP_TYPE,
      [],
    );
    expect(view.detail).toBe('In bed · Woke naturally');
  });

  it('has no unknown-key noise from undeclared pause keys on other types', () => {
    const view = presentEvent(
      event({
        id: 'f',
        typeId: BUILT_IN_TYPES[1].id,
        payload: { method: 'breast', pause_count: 1, paused_seconds: 60, side_since: '2026-10-20' },
      }),
      BUILT_IN_TYPES[1],
      [],
    );
    expect(view.detail).not.toMatch(/pause|side/i);
  });
});
