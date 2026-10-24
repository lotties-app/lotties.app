import { describe, expect, it } from 'vitest';
import type { EventPayload } from '../db/models';
import vectors from './bottleSegmentsVectors.json';
import {
  closeAtStop,
  closeSegment,
  currentStartLevel,
  formatSegments,
  levelChoices,
  parseSegments,
  readSegments,
  segmentDrunkMl,
  segmentsProblem,
  settleSegments,
  withLastLevel,
} from './bottleSegments';

const bottle = (extra: EventPayload = {}): EventPayload => ({
  method: 'bottle',
  amount_ml: 120,
  ...extra,
});

describe('the shared vectors (same as the API BottleSegments)', () => {
  it.each(vectors.parse.map((v, i) => [i, v] as const))('parse #%i', (_, vector) => {
    expect(parseSegments(vector.text)).toEqual(vector.segments);
  });

  it.each(vectors.payloads.map((v) => [v.note, v] as const))('rules: %s', (_, vector) => {
    expect(segmentsProblem(vector.payload as EventPayload, vector.ended)).toBe(!vector.valid);
  });

  it('formats what it parses', () => {
    for (const vector of vectors.parse) {
      if (vector.segments) expect(formatSegments(vector.segments)).toBe(vector.text);
    }
  });
});

describe('stretches written at pauses and at the stop', () => {
  it('the first pause closes a stretch from the prepared amount, level unknown', () => {
    const paused = closeSegment(bottle(), 300.9, null);
    expect(paused.segments).toBe('120>?@300');
    expect(segmentsProblem(paused, false)).toBe(false);
  });

  it('the answer fills the level and the next stretch starts there', () => {
    const answered = withLastLevel(closeSegment(bottle(), 300, null), 70, 1);
    expect(answered.segments).toBe('120>70@300');
    expect(currentStartLevel(answered)).toBe(70);
    const again = closeSegment(answered, 540, 30);
    expect(again.segments).toBe('120>70@300;70>30@240');
    expect(readSegments(again).map(segmentDrunkMl)).toEqual([50, 40]);
  });

  it('a late answer (after the next pause) or one that does not fit changes nothing', () => {
    const two = closeSegment(closeSegment(bottle(), 300, null), 500, null);
    expect(withLastLevel(two, 40, 1)).toBe(two);
    const one = closeSegment(bottle(), 300, null);
    expect(withLastLevel(one, 130)).toBe(one);
    const lower = closeSegment(withLastLevel(one, 60), 400, null);
    expect(withLastLevel(lower, 80)).toBe(lower);
  });

  it('without a prepared amount the first level is unknown; levels are whole ml', () => {
    const paused = closeSegment({ method: 'bottle' }, 120, 40.7);
    expect(paused.segments).toBe('?>40@120');
  });

  it('at the cap of 20 stretches the last one is extended', () => {
    let payload: EventPayload = bottle();
    for (let i = 1; i <= 21; i += 1) payload = closeSegment(payload, i * 10, null);
    const segments = readSegments(payload);
    expect(segments).toHaveLength(20);
    expect(segments[19].seconds).toBe(20);
  });

  it('the stop closes the last stretch with the level the totals give', () => {
    const paused = withLastLevel(closeSegment(bottle(), 300, null), 70);
    expect(closeAtStop({ ...paused, amount_drunk_ml: 100 }, 540).segments).toBe(
      '120>70@300;70>20@240',
    );
    // No drunk amount = all of it: empty at the end.
    expect(closeAtStop(paused, 540).segments).toBe('120>70@300;70>0@240');
  });

  it('a stop while paused gives the last stretch the level instead of a stretch of 0 s', () => {
    const paused = closeSegment(bottle(), 300, null);
    expect(closeAtStop({ ...paused, amount_drunk_ml: 50 }, 300).segments).toBe('120>70@300');
  });

  it('a sleep stop without a drunk amount leaves the end unknown', () => {
    const paused = withLastLevel(closeSegment(bottle(), 300, null), 70);
    expect(closeAtStop({ ...paused, ended_by: 'sleep' }, 420).segments).toBe('120>70@300;70>?@120');
  });

  it('a bottle never paused gets no stretches', () => {
    expect(closeAtStop(bottle(), 600)).toEqual(bottle());
  });
});

describe('settleSegments keeps the stretches agreeing with the amounts', () => {
  it('leaves agreeing stretches alone', () => {
    const payload = bottle({ segments: '120>70@300' });
    expect(settleSegments(payload, false)).toBe(payload);
  });

  it('moves the last level to what the totals say once ended', () => {
    const payload = bottle({ amount_drunk_ml: 90, segments: '120>70@300;70>0@200' });
    expect(settleSegments(payload, true).segments).toBe('120>70@300;70>30@200');
  });

  it('forgets a last level that cannot agree, then drops the stretches', () => {
    expect(
      settleSegments(bottle({ amount_drunk_ml: 30, segments: '120>60@300;60>0@200' }), true)
        .segments,
    ).toBeUndefined();
    expect(settleSegments(bottle({ amount_drunk_ml: 30, segments: '120>60@300' }), false)).toEqual(
      bottle({ amount_drunk_ml: 30, segments: '120>?@300' }),
    );
    // The prepared amount was lowered under a level.
    expect(settleSegments(bottle({ amount_ml: 60, segments: '120>?@300' }), false)).toEqual({
      method: 'bottle',
      amount_ml: 60,
    });
  });

  it('never touches anything but a bottle', () => {
    const custom = { method: 'spoon', segments: '5>9@1' };
    expect(settleSegments(custom, true)).toBe(custom);
  });
});

describe('levelChoices', () => {
  it('full, 3/4, half, 1/4 and empty of the prepared amount, descending', () => {
    expect(levelChoices(120)).toEqual([
      { ml: 120, share: 'full' },
      { ml: 90, share: 'threeQuarters' },
      { ml: 60, share: 'half' },
      { ml: 30, share: 'quarter' },
      { ml: 0, share: 'empty' },
    ]);
  });

  it('leaves out what is above the level the stretch started at', () => {
    expect(levelChoices(120, 70).map((c) => c.share)).toEqual(['half', 'quarter', 'empty']);
  });

  it('has nothing without a prepared amount, and each amount once', () => {
    expect(levelChoices(null)).toEqual([]);
    expect(levelChoices(0)).toEqual([]);
    expect(levelChoices(10).map((c) => c.ml)).toEqual([10, 5, 0]);
  });
});
