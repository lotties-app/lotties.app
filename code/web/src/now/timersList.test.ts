import { describe, expect, it } from 'vitest';
import { event } from '../presets/presetFixtures';
import { FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { otherTimers } from './timers';

const TYPES = [FEEDING_TYPE, SLEEP_TYPE];

describe('otherTimers', () => {
  it('leaves out sleep (the state card) and the nursing session (its own card)', () => {
    const sleep = event({ id: 'sleep', typeId: SLEEP_TYPE.id });
    const nursing = event({
      id: 'nursing',
      typeId: FEEDING_TYPE.id,
      payload: { method: 'breast' },
    });
    const oldFeeding = event({ id: 'old', typeId: FEEDING_TYPE.id });
    const tummy = event({ id: 'tummy', typeId: 'type-tummy' });
    expect(
      otherTimers([sleep, nursing, oldFeeding, tummy], TYPES, 'nursing').map((e) => e.id),
    ).toEqual(['old', 'tummy']);
    expect(otherTimers([sleep, nursing], TYPES, null).map((e) => e.id)).toEqual(['nursing']);
  });
});
