import { describe, expect, it } from 'vitest';
import { i18n, loadLocale } from '../i18n/i18n';
import { BUILT_IN_TYPES, DIAPER_T, SLEEP, event } from '../presets/presetFixtures';
import { INSIGHTS, insightById, relevantEvents } from './catalogue';
import { estimateLine, progressText } from './insightText';
import { LOOK_BACK_DAYS, readiness } from './readiness';

/** Local wall-clock instants: day 0 is "today" (21 Oct 2026), negative days are in the past. */
const NOW = new Date(2026, 9, 21, 15, 0);
const at = (day: number, hour = 10, minute = 0) =>
  new Date(2026, 9, 21 + day, hour, minute).toISOString();
/** One start per listed day. */
const onDays = (...days: number[]) => days.map((day) => at(day));

const sleep = insightById('sleep'); // 3 days, 3 events
const rhythm = insightById('sleepRhythm'); // 7 days, 7 events
const feeding = insightById('feeding'); // 3 days, 6 events

describe('readiness', () => {
  it('without any data asks to start logging', () => {
    const state = readiness(sleep, [], NOW);
    expect(state).toMatchObject({
      state: 'start',
      daysWithData: 0,
      progress: 0,
      daysLeft: null,
      eventsLeft: null,
    });
  });

  it('with no data in the last 7 days (pace zero) asks to start logging again', () => {
    const state = readiness(rhythm, onDays(-20, -19, -18), NOW);
    expect(state.state).toBe('start');
    expect(state.daysWithData).toBe(3);
    expect(state.progress).toBeCloseTo(3 / 7);
  });

  it('projects the remaining days at the recent pace', () => {
    // First data 10 days ago; in the last 7 days data on 2 of the 6 finished ones (today is empty).
    const state = readiness(rhythm, onDays(-10, -4, -1), NOW);
    expect(state).toMatchObject({ state: 'days', daysWithData: 3, daysLeft: 12 });
  });

  it('does not measure someone who just started against a whole week', () => {
    // Logging every day since the day before yesterday: pace 1, one day missing.
    const state = readiness(sleep, onDays(-2, -1), NOW);
    expect(state).toMatchObject({ state: 'days', daysWithData: 2, daysLeft: 1 });
    expect(state.progress).toBeCloseTo(2 / 3);
  });

  it('counts today once it has data, not before', () => {
    expect(readiness(rhythm, onDays(-1, 0), NOW)).toMatchObject({ daysLeft: 5 });
    expect(readiness(rhythm, onDays(-3, -1), NOW)).toMatchObject({
      // 3 days considered (-3, -2, -1), 2 with data: 5 days at 2/3 a day.
      daysLeft: Math.ceil((5 * 3) / 2),
    });
  });

  it('opens with enough days and events', () => {
    const starts = [...onDays(-3, -2, -1), at(-1, 14)];
    expect(readiness(sleep, starts, NOW)).toMatchObject({ state: 'unlocked', progress: 1 });
  });

  it('asks for a few more events when the days are there', () => {
    const state = readiness(feeding, onDays(-3, -2, -1), NOW);
    expect(state).toMatchObject({ state: 'events', eventsLeft: 3, daysLeft: null });
  });

  it('counts imported history at once (its days are real dates)', () => {
    // Two weeks imported from Napper that ended 10 days ago, nothing logged since.
    const imported = Array.from({ length: 14 }, (_, index) => at(-23 + index));
    expect(readiness(rhythm, imported, NOW).state).toBe('unlocked');
  });

  it(`only counts the last ${LOOK_BACK_DAYS} days`, () => {
    const old = onDays(-40, -39, -38, -37, -36, -35, -34);
    expect(readiness(rhythm, old, NOW)).toMatchObject({ state: 'start', daysWithData: 0 });
  });

  it('ignores events that start after now', () => {
    expect(readiness(sleep, [at(0, 18)], NOW)).toMatchObject({ state: 'start', daysWithData: 0 });
  });
});

describe('relevant events', () => {
  it('counts sleep sessions only, live ones, started by now', () => {
    const events = [
      event({ id: 'nap', typeId: SLEEP, startedAt: at(-1), payload: { kind: 'nap' } }),
      event({ id: 'old-timer', typeId: SLEEP, startedAt: at(-1, 11), payload: {} }),
      event({ id: 'marker', typeId: SLEEP, startedAt: at(-1, 6), payload: { kind: 'woke_up' } }),
      event({
        id: 'waking',
        typeId: SLEEP,
        startedAt: at(-1, 2),
        payload: { kind: 'night_waking' },
      }),
      event({ id: 'gone', typeId: SLEEP, startedAt: at(-2), deletedAt: at(-1) }),
      event({ id: 'later', typeId: SLEEP, startedAt: at(0, 20), payload: { kind: 'nap' } }),
      event({ id: 'diaper', typeId: DIAPER_T, startedAt: at(-1) }),
    ];
    expect(relevantEvents(sleep, events, BUILT_IN_TYPES, NOW).map((e) => e.id)).toEqual([
      'nap',
      'old-timer',
    ]);
    expect(
      relevantEvents(insightById('diapers'), events, BUILT_IN_TYPES, NOW).map((e) => e.id),
    ).toEqual(['diaper']);
  });

  it('has a catalogue with growing thresholds for the sleep views', () => {
    expect(INSIGHTS.map((i) => [i.id, i.minDays])).toEqual([
      ['sleep', 3],
      ['sleepRhythm', 7],
      ['feeding', 3],
      ['diapers', 3],
    ]);
  });
});

describe('estimate wording', () => {
  const t = i18n.getFixedT('en');
  const pt = i18n.getFixedT('pt-BR');

  it('is friendly, singular and plural', async () => {
    await loadLocale('pt-BR');
    const one = readiness(sleep, onDays(-2, -1), NOW);
    const many = readiness(rhythm, onDays(-2, -1), NOW);
    expect(estimateLine(t, one)).toBe('About 1 more day of logging');
    expect(estimateLine(t, many)).toBe('About 5 more days of logging');
    expect(progressText(t, many)).toBe('Day 2 of 7');
    expect(estimateLine(pt, one)).toBe('Cerca de mais 1 dia de registros');
    expect(estimateLine(pt, many)).toBe('Cerca de mais 5 dias de registros');
    expect(progressText(pt, many)).toBe('Dia 2 de 7');
  });

  it('says what to start logging, or how many more events', () => {
    expect(estimateLine(t, readiness(feeding, [], NOW))).toBe('Start logging feeds to unlock');
    expect(estimateLine(t, readiness(feeding, onDays(-3, -2, -1), NOW))).toBe(
      'Log 3 more feeds to unlock',
    );
    expect(
      estimateLine(t, readiness(feeding, [...onDays(-3, -2, -1), ...onDays(-3, -2)], NOW)),
    ).toBe('Log 1 more feed to unlock');
  });
});
