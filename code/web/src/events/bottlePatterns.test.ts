import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventPayload } from '../db/models';
import { FEEDING_TYPE } from '../test/builtInTypes';
import { BABY_ID } from '../test/fakeApi';
import {
  MAX_TOP_UP_SHARE,
  adjustedFeedGap,
  bottlePace,
  expectedBottleMinutes,
  hasUnknownFinish,
  knownDrunkMl,
  topUpAdjustment,
  usualDrunkMl,
} from './bottlePatterns';

/** Local time on 2026-10-21 (`day` shifts the date). */
const at = (hour: number, minute = 0, day = 21) => new Date(2026, 9, day, hour, minute);
const NOW = at(15);

let counter = 0;
function bottle(
  start: Date,
  minutes: number,
  payload: EventPayload,
  extra: Partial<BabyEvent> = {},
) {
  counter += 1;
  return {
    id: `b-${counter}`,
    babyId: BABY_ID,
    typeId: FEEDING_TYPE.id,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    payload: { method: 'bottle', ...payload },
    notes: null,
    createdBy: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
    ...extra,
  } satisfies BabyEvent;
}

describe('unknown finishes', () => {
  it('a bottle a sleep stopped without an amount is unknown; with one it is known', () => {
    expect(hasUnknownFinish({ method: 'bottle', amount_ml: 120, ended_by: 'sleep' })).toBe(true);
    expect(
      hasUnknownFinish({
        method: 'bottle',
        amount_ml: 120,
        ended_by: 'sleep',
        segments: '120>60@300;60>?@200',
      }),
    ).toBe(true);
    expect(
      hasUnknownFinish({
        method: 'bottle',
        amount_ml: 120,
        ended_by: 'sleep',
        amount_drunk_ml: 90,
      }),
    ).toBe(false);
    expect(hasUnknownFinish({ method: 'bottle', amount_ml: 120 })).toBe(false);
    expect(knownDrunkMl({ payload: { method: 'bottle', amount_ml: 120, ended_by: 'sleep' } })).toBe(
      null,
    );
    expect(knownDrunkMl({ payload: { method: 'bottle', amount_ml: 120 } })).toBe(120);
  });
});

describe('bottlePace and the bottle duration estimate', () => {
  const history = [
    bottle(at(8, 0, 20), 12, { amount_ml: 120 }), // 10 ml/min
    bottle(at(12, 0, 20), 15, { amount_ml: 150, paused_seconds: 300, pause_count: 1 }), // 15
    bottle(at(8, 0, 21), 10, {
      amount_ml: 120,
      amount_drunk_ml: 80,
      segments: '120>60@240;60>40@360',
    }), // 8
  ];

  it('is the median ml per minute of drinking, pauses excluded, from at least 3 bottles', () => {
    expect(bottlePace(history, NOW)).toEqual({
      mlPerMinute: 10,
      sampleCount: 3,
      typicalStretchMl: null,
    });
    expect(bottlePace(history.slice(0, 2), NOW)).toBeNull();
  });

  it('leaves out instant bottles, unknown finishes, old ones and typing slips', () => {
    const noise = [
      bottle(at(9, 0, 21), 0, { amount_ml: 120 }),
      bottle(at(10, 0, 21), 20, { amount_ml: 120, ended_by: 'sleep' }),
      bottle(at(9, 0, 1), 10, { amount_ml: 120 }),
      bottle(at(11, 0, 21), 1, { amount_ml: 900 }),
    ];
    expect(bottlePace([...history, ...noise], NOW)?.sampleCount).toBe(3);
  });

  it('knows her typical stretch once 3 stretches are known', () => {
    const more = [
      ...history,
      bottle(at(10, 0, 21), 12, { amount_ml: 120, segments: '120>70@300;70>0@420' }),
    ];
    expect(bottlePace(more, NOW)?.typicalStretchMl).toBe(55);
  });

  it('expects a running bottle to take about prepared / pace, else her usual amount', () => {
    const pace = bottlePace(history, NOW);
    expect(expectedBottleMinutes({ payload: { method: 'bottle', amount_ml: 130 } }, pace)).toBe(13);
    expect(expectedBottleMinutes({ payload: { method: 'bottle' } }, pace, 100)).toBe(10);
    expect(expectedBottleMinutes({ payload: { method: 'bottle' } }, pace)).toBeNull();
    expect(
      expectedBottleMinutes({ payload: { method: 'bottle', amount_ml: 120 } }, null),
    ).toBeNull();
    // Out of bounds (under 3 min): nothing.
    expect(
      expectedBottleMinutes({ payload: { method: 'bottle', amount_ml: 20 } }, pace),
    ).toBeNull();
  });
});

describe('usualDrunkMl', () => {
  it('prefers the same part of the day, else all of them', () => {
    const events = [
      bottle(at(9, 0, 20), 10, { amount_ml: 150 }),
      bottle(at(13, 0, 20), 10, { amount_ml: 150 }),
      bottle(at(10, 0, 21), 10, { amount_ml: 160 }),
      bottle(at(22, 0, 19), 10, { amount_ml: 90 }),
      bottle(at(2, 0, 20), 10, { amount_ml: 100 }),
      bottle(at(23, 0, 20), 10, { amount_ml: 110 }),
    ];
    expect(usualDrunkMl(events, at(14).toISOString(), NOW)).toBe(150);
    expect(usualDrunkMl(events, at(3).toISOString(), NOW)).toBe(100);
    expect(usualDrunkMl(events.slice(0, 2), at(14).toISOString(), NOW)).toBeNull();
  });
});

describe('topUpAdjustment: the next feed comes earlier after a partial bottle', () => {
  const usual = [
    bottle(at(9, 0, 20), 10, { amount_ml: 120 }),
    bottle(at(13, 0, 20), 10, { amount_ml: 120 }),
    bottle(at(9, 0, 21), 10, { amount_ml: 120 }),
  ];

  it('nothing after a full bottle, a nursing session, an unknown finish or without history', () => {
    expect(topUpAdjustment([...usual, bottle(at(13), 10, { amount_ml: 120 })], NOW)).toBeNull();
    expect(
      topUpAdjustment([...usual, bottle(at(13), 10, { amount_ml: 120, amount_drunk_ml: 90 })], NOW),
    ).toBeNull();
    expect(topUpAdjustment([...usual, bottle(at(13), 10, { method: 'breast' })], NOW)).toBeNull();
    expect(
      topUpAdjustment([...usual, bottle(at(13), 10, { amount_ml: 120, ended_by: 'sleep' })], NOW),
    ).toBeNull();
    expect(
      topUpAdjustment([bottle(at(13), 10, { amount_ml: 120, amount_drunk_ml: 20 })], NOW),
    ).toBeNull();
    const running = { ...bottle(at(14, 50), 0, { amount_ml: 120 }), endedAt: null };
    expect(topUpAdjustment([...usual, running], NOW)).toBeNull();
  });

  it('half of the missing share, bounded by the cap', () => {
    const half = topUpAdjustment(
      [...usual, bottle(at(13), 10, { amount_ml: 120, amount_drunk_ml: 60 })],
      NOW,
    );
    expect(half).toEqual({ share: 0.25, drunkMl: 60, usualMl: 120, endedBySleep: false });
    expect(adjustedFeedGap(180, half)).toBe(135);
    const little = topUpAdjustment(
      [...usual, bottle(at(13), 10, { amount_ml: 120, amount_drunk_ml: 10, ended_by: 'sleep' })],
      NOW,
    );
    expect(little).toMatchObject({ share: MAX_TOP_UP_SHARE, endedBySleep: true });
    expect(adjustedFeedGap(180, little)).toBe(126);
    expect(adjustedFeedGap(180, null)).toBe(180);
  });
});
