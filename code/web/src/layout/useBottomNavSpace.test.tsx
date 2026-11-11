import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NAV_HEIGHT, NAV_INSET, NAV_TOAST_BOTTOM, TOAST_BOTTOM_VAR } from './navMetrics';
import { useBottomNavSpace } from './useBottomNavSpace';

const offset = () => document.documentElement.style.getPropertyValue(TOAST_BOTTOM_VAR);

describe('useBottomNavSpace', () => {
  it('lifts the toasts above the dock and the inset while a dock is mounted', () => {
    expect(offset()).toBe('');
    const first = renderHook(() => useBottomNavSpace());
    expect(offset()).toBe(NAV_TOAST_BOTTOM);
    expect(NAV_TOAST_BOTTOM).toContain(`${NAV_HEIGHT + NAV_INSET + 12}px`);
    expect(NAV_TOAST_BOTTOM).toContain('env(safe-area-inset-bottom)');
    // A second dock (shell swap) keeps the space until both are gone.
    const second = renderHook(() => useBottomNavSpace());
    first.unmount();
    expect(offset()).toBe(NAV_TOAST_BOTTOM);
    second.unmount();
    expect(offset()).toBe('');
  });

  it('reserves nothing when inactive (the doctor rail sits beside the content)', () => {
    const { rerender, unmount } = renderHook(({ active }) => useBottomNavSpace(active), {
      initialProps: { active: false },
    });
    expect(offset()).toBe('');
    rerender({ active: true });
    expect(offset()).toBe(NAV_TOAST_BOTTOM);
    rerender({ active: false });
    expect(offset()).toBe('');
    unmount();
  });
});
