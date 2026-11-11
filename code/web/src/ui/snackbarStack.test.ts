import { afterEach, describe, expect, it } from 'vitest';
import { NO_NAV_TOAST_BOTTOM, TOAST_BOTTOM, TOAST_BOTTOM_VAR } from '../layout/navMetrics';
import {
  FALLBACK_HEIGHT,
  STACKED_TOAST_BOTTOM,
  STACK_GAP,
  STACK_OFFSET_VAR,
  closeStackEntry,
  openStackEntry,
  setStackHeight,
  stackEntries,
  stackOffset,
} from './snackbarStack';

afterEach(() => {
  for (const entry of [...stackEntries()]) closeStackEntry(entry.id);
});

describe('stackOffset', () => {
  it('puts the first notice on the shared offset and each later one above the earlier ones', () => {
    const entries = [
      { id: 'a', height: 48 },
      { id: 'b', height: 72 },
      { id: 'c', height: 40 },
    ];
    expect(stackOffset(entries, 'a')).toBe(0);
    expect(stackOffset(entries, 'b')).toBe(48 + STACK_GAP);
    expect(stackOffset(entries, 'c')).toBe(48 + 72 + 2 * STACK_GAP);
  });

  it('uses a one-line height for a notice not measured yet, and 0 for an unknown id', () => {
    expect(
      stackOffset(
        [
          { id: 'a', height: 0 },
          { id: 'b', height: 0 },
        ],
        'b',
      ),
    ).toBe(FALLBACK_HEIGHT + STACK_GAP);
    expect(stackOffset([{ id: 'a', height: 48 }], 'zz')).toBe(0);
  });
});

describe('stack store', () => {
  it('moves the later notices down when an earlier one closes', () => {
    openStackEntry('a');
    openStackEntry('b');
    openStackEntry('a');
    setStackHeight('a', 60);
    setStackHeight('b', 50);
    expect(stackEntries()).toEqual([
      { id: 'a', height: 60 },
      { id: 'b', height: 50 },
    ]);
    expect(stackOffset(stackEntries(), 'b')).toBe(60 + STACK_GAP);
    closeStackEntry('a');
    expect(stackOffset(stackEntries(), 'b')).toBe(0);
  });
});

describe('shared toast offset', () => {
  it('is the dock variable with the no-dock fallback, both above the safe-area inset', () => {
    expect(TOAST_BOTTOM).toBe(`var(${TOAST_BOTTOM_VAR}, ${NO_NAV_TOAST_BOTTOM})`);
    expect(NO_NAV_TOAST_BOTTOM).toContain('env(safe-area-inset-bottom)');
    expect(STACKED_TOAST_BOTTOM).toBe(`calc(${TOAST_BOTTOM} + var(${STACK_OFFSET_VAR}, 0px))`);
  });
});
