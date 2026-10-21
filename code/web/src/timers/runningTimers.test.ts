import { describe, expect, it } from 'vitest';
import { BUILT_IN_TYPES, FEEDING_T, SLEEP, event } from '../presets/presetFixtures';
import { runningTimers } from './runningTimers';

const timer = (id: string, typeId: string, startedAt: string, payload = {}, endedAt = null) =>
  event({ id, typeId, startedAt, payload, endedAt });

describe('runningTimers', () => {
  it('puts a sleep first, then nursing, other timers, and a night waking last', () => {
    const list = runningTimers(
      [
        timer('tummy', 'type-tummy', '2026-10-21T10:00:00.000Z'),
        timer('waking', SLEEP, '2026-10-21T09:00:00.000Z', { kind: 'night_waking' }),
        timer('nursing', FEEDING_T, '2026-10-21T11:00:00.000Z', { method: 'breast' }),
        timer('nap', SLEEP, '2026-10-21T12:00:00.000Z', { kind: 'nap' }),
      ],
      BUILT_IN_TYPES,
    );
    expect(list.map((t) => [t.event.id, t.kind])).toEqual([
      ['nap', 'sleep'],
      ['nursing', 'nursing'],
      ['tummy', 'other'],
      ['waking', 'waking'],
    ]);
    expect(list[0].sleepKind).toBe('nap');
  });

  it('orders timers of the same kind oldest first and ignores stopped and deleted ones', () => {
    const list = runningTimers(
      [
        timer('late', SLEEP, '2026-10-21T12:00:00.000Z', { kind: 'nap' }),
        timer('early', SLEEP, '2026-10-21T08:00:00.000Z', { kind: 'night' }),
        timer(
          'done',
          SLEEP,
          '2026-10-21T07:00:00.000Z',
          { kind: 'nap' },
          '2026-10-21T07:30:00.000Z' as never,
        ),
        {
          ...timer('gone', SLEEP, '2026-10-21T06:00:00.000Z'),
          deletedAt: '2026-10-21T06:05:00.000Z',
        },
      ],
      BUILT_IN_TYPES,
    );
    expect(list.map((t) => t.event.id)).toEqual(['early', 'late']);
    expect(list[0].sleepKind).toBe('night');
  });

  it('treats a feeding timer without a breast method as an ordinary timer', () => {
    const [only] = runningTimers(
      [timer('bottle', FEEDING_T, '2026-10-21T10:00:00.000Z')],
      BUILT_IN_TYPES,
    );
    expect(only.kind).toBe('other');
  });
});
