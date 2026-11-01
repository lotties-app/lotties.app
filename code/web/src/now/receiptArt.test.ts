import { describe, expect, it } from 'vitest';
import { ILLUSTRATION_NAMES, illustrationName } from '../ui/illustrations';
import { receiptArt } from './receiptArt';
import type { Receipt } from './nowText';

const receipts: Receipt[] = [
  { kind: 'sleep', action: 'fell_asleep', sleepKind: 'nap' },
  { kind: 'sleep', action: 'fell_asleep', sleepKind: 'night' },
  { kind: 'sleep', action: 'bedtime' },
  { kind: 'sleep', action: 'woke_up' },
  { kind: 'sleep', action: 'up_for_the_day' },
  { kind: 'sleep', action: 'night_waking' },
  { kind: 'sleep', action: 'back_asleep' },
  { kind: 'tray', choice: { kind: 'bottle', amountMl: 90, content: 'formula' } },
  { kind: 'tray', choice: { kind: 'diaper', content: 'WET' } },
  { kind: 'tray', choice: { kind: 'medication', medications: [] } },
  { kind: 'tray', choice: { kind: 'belly_pain', intensity: 3 } },
  { kind: 'tray', choice: { kind: 'breast', side: 'left' } },
  { kind: 'nursing_started', side: 'left' },
  { kind: 'nursing_switched', side: 'right' },
  { kind: 'nursing_stopped', leftSeconds: 1, rightSeconds: 2 },
];

describe('receiptArt', () => {
  it('maps every receipt to a drawn illustration', () => {
    for (const receipt of receipts) {
      const key = illustrationName(receiptArt(receipt));
      expect(key, JSON.stringify(receipt)).toBeDefined();
      expect(ILLUSTRATION_NAMES).toContain(key);
    }
  });

  it('picks the nap or the night drawing by sleep kind', () => {
    expect(receiptArt(receipts[0])).toBe('nap');
    expect(receiptArt(receipts[1])).toBe('night');
  });
});
