import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { eventType } from '../presets/presetFixtures';
import { FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID } from '../test/fakeApi';
import { bottleFollowUp, fedToSleep } from './bottleFollowUp';

const TYPES: EventType[] = [FEEDING_TYPE, SLEEP_TYPE];
const at = (hour: number, minute = 0) => new Date(2026, 9, 21, hour, minute);
const NOW = at(14);

let counter = 0;
function ev(type: EventType, start: Date, end: Date | null, payload: EventPayload): BabyEvent {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    babyId: BABY_ID,
    typeId: type.id,
    startedAt: start.toISOString(),
    endedAt: end?.toISOString() ?? null,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
  };
}

const interrupted = (extra: EventPayload = {}, end = at(13, 20)) =>
  ev(FEEDING_TYPE, at(13), end, {
    method: 'bottle',
    amount_ml: 120,
    ended_by: 'sleep',
    ...extra,
  });

describe('bottleFollowUp', () => {
  it('asks about the latest bottle a sleep stopped without an amount', () => {
    const bottle = interrupted({ segments: '120>80@300;80>?@600' });
    expect(bottleFollowUp([bottle], TYPES, NOW, null)).toEqual({
      event: bottle,
      preparedMl: 120,
      ceilingMl: 80,
      count: 2,
    });
    expect(bottleFollowUp([interrupted()], TYPES, NOW, null)).toMatchObject({
      ceilingMl: null,
      count: 0,
    });
  });

  it('asks nothing once dismissed, answered, too old, or when a newer feed came', () => {
    const bottle = interrupted();
    expect(bottleFollowUp([bottle], TYPES, NOW, bottle.id)).toBeNull();
    expect(bottleFollowUp([interrupted({ amount_drunk_ml: 90 })], TYPES, NOW, null)).toBeNull();
    expect(
      bottleFollowUp([interrupted({ segments: '120>80@300;80>20@600' })], TYPES, NOW, null),
    ).toBeNull();
    expect(bottleFollowUp([bottle], TYPES, new Date(2026, 9, 22, 2), null)).toBeNull();
    const nursing = ev(FEEDING_TYPE, at(13, 40), at(13, 50), { method: 'breast' });
    expect(bottleFollowUp([bottle, nursing], TYPES, NOW, null)).toBeNull();
  });

  it('asks nothing for a bottle the parent stopped, one without a prepared amount, or a custom type', () => {
    expect(
      bottleFollowUp(
        [ev(FEEDING_TYPE, at(13), at(13, 20), { method: 'bottle', amount_ml: 120 })],
        TYPES,
        NOW,
        null,
      ),
    ).toBeNull();
    expect(bottleFollowUp([interrupted({ amount_ml: undefined })], TYPES, NOW, null)).toBeNull();
    const custom = eventType({
      id: 'own-feeding',
      key: 'feeding',
      name: 'Feeding',
      babyId: BABY_ID,
    });
    const own = { ...interrupted(), typeId: custom.id };
    expect(bottleFollowUp([own], [...TYPES, custom], NOW, null)).toBeNull();
  });
});

describe('fedToSleep', () => {
  it('names the feed a sleep began during (same instant, ended by the sleep)', () => {
    const nap = ev(SLEEP_TYPE, at(13, 20), at(14), { kind: 'nap' });
    expect(fedToSleep(nap, [interrupted()])).toBe('bottle');
    const nursing = ev(FEEDING_TYPE, at(13), at(13, 20), { method: 'breast', ended_by: 'sleep' });
    expect(fedToSleep(nap, [nursing])).toBe('nursing');
  });

  it('is null for a feed that just ended before, or one the parent stopped at that instant', () => {
    const nap = ev(SLEEP_TYPE, at(13, 20), at(14), { kind: 'nap' });
    expect(fedToSleep(nap, [interrupted({}, at(13, 19))])).toBeNull();
    const stopped = ev(FEEDING_TYPE, at(13), at(13, 20), { method: 'bottle', amount_ml: 90 });
    expect(fedToSleep(nap, [stopped])).toBeNull();
    expect(fedToSleep({ ...nap, deletedAt: at(14).toISOString() }, [interrupted()])).toBeNull();
  });
});
